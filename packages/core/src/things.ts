import { generateNKeysBetween } from "fractional-indexing";
import { create, type Doc } from "./doc";
import type { Day, Id, Repeat, Start, Status, Unit } from "./model";
import type { Ctx, Op } from "./ops";

type Row = Record<string, unknown>;

/** Tables of a Things 3 `main.sqlite`, as rows (what `things_read` returns). */
export interface ThingsData {
  TMTask: Row[];
  TMArea: Row[];
  TMTag: Row[];
  TMTaskTag: Row[];
  TMAreaTag: Row[];
  TMChecklistItem: Row[];
}

const num = (x: unknown) => (typeof x === "number" ? x : null);
const str = (x: unknown) => (typeof x === "string" && x ? x : null);
const two = (n: number) => String(n).padStart(2, "0");

/** Things packs days as `year << 16 | month << 12 | day << 7`. */
export function decodeDay(packed: unknown): Day | null {
  const v = num(packed);
  if (!v) return null;
  const y = v >> 16;
  const m = (v >> 12) & 0xf;
  const d = (v >> 7) & 0x1f;
  return y && m && d ? `${y}-${two(m)}-${two(d)}` : null;
}

/** Reminder times are packed as `hour << 26 | minute << 20`. */
export function decodeTime(packed: unknown): string | null {
  const v = num(packed);
  if (v === null) return null;
  return `${two((v >> 26) & 0x1f)}:${two((v >> 20) & 0x3f)}`;
}

const UNITS: Record<number, Unit> = { 16: "day", 256: "week", 8: "month", 4: "year" };

/** Reads the frequency (`fu` unit, `fa` amount) and type (`tp`: 0 fixed, 1 after completion) of a rule plist. */
export function decodeRule(plist: unknown): Repeat | null {
  const text = str(plist);
  if (!text) return null;
  const int = (key: string) => {
    const m = text.match(new RegExp(`<key>${key}</key>\\s*<integer>(-?\\d+)</integer>`));
    return m ? Number(m[1]) : null;
  };
  const unit = UNITS[int("fu") ?? -1];
  if (!unit) return null;
  return { mode: int("tp") === 1 ? "after" : "schedule", every: Math.max(1, int("fa") ?? 1), unit };
}

const STATUS: Record<number, Status> = { 0: "open", 2: "canceled", 3: "completed" };
const START: Start[] = ["inbox", "anytime", "someday"];
const ms = (seconds: unknown) => (num(seconds) === null ? null : Math.round(num(seconds)! * 1000));
const notes = (x: unknown) => (str(x) ?? "").replace(/^<note[^>]*>([\s\S]*)<\/note>$/, "$1");

function keysInOrder<T>(rows: T[], by: (r: T) => number | null): Map<T, string> {
  const sorted = [...rows].sort((a, b) => (by(a) ?? Infinity) - (by(b) ?? Infinity));
  const keys = generateNKeysBetween(null, null, sorted.length);
  return new Map(sorted.map((r, i) => [r, keys[i]!]));
}

/** Maps a Things database into new stuff objects with fresh ids. */
export const importThings =
  (data: ThingsData): Op =>
  (ctx: Ctx) => {
    const ids = new Map<string, Id>();
    const idOf = (uuid: unknown) => {
      const u = str(uuid);
      if (!u) return null;
      if (!ids.has(u)) ids.set(u, ctx.id());
      return ids.get(u)!;
    };
    const tagsOf = (rows: Row[], owner: string, uuid: unknown) =>
      rows.filter((r) => r[owner] === uuid).flatMap((r) => idOf(r.tags) ?? []);
    const out: Doc[] = [];
    const make = (
      type: Parameters<typeof create>[0],
      uuid: unknown,
      fields: Record<string, unknown>,
    ) => out.push(create(type, idOf(uuid)!, fields as never, ctx.clock));

    const areaKeys = keysInOrder(data.TMArea, (r) => num(r.index));
    for (const a of data.TMArea)
      make("area", a.uuid, {
        title: str(a.title) ?? "",
        index: areaKeys.get(a),
        tags: tagsOf(data.TMAreaTag, "areas", a.uuid),
      });

    const tagKeys = keysInOrder(data.TMTag, (r) => num(r.index));
    for (const t of data.TMTag)
      make("tag", t.uuid, {
        title: str(t.title) ?? "",
        parent: idOf(t.parent),
        index: tagKeys.get(t),
        shortcut: str(t.shortcut) ?? "",
      });

    const tasks = data.TMTask;
    const byUuid = new Map(tasks.map((t) => [t.uuid, t]));
    const index = keysInOrder(tasks, (r) => num(r.index));
    const todayIndex = keysInOrder(tasks, (r) => num(r.todayIndex));
    for (const t of tasks) {
      const type = num(t.type);
      const heading = type === 0 ? str(t.heading) : null;
      const project = str(t.project) ?? (heading ? str(byUuid.get(heading)?.project) : null);
      const base = {
        title: str(t.title) ?? "",
        index: index.get(t),
        trashed: t.trashed === 1,
      };
      if (type === 2) {
        make("heading", t.uuid, { ...base, project: idOf(project), archived: num(t.status) === 3 });
        continue;
      }
      if (type !== 0 && type !== 1) continue;
      const rule = type === 0 ? decodeRule(t.rt1_recurrenceRule) : null;
      const task = {
        ...base,
        notes: notes(t.notes),
        status: STATUS[num(t.status) ?? 0] ?? "open",
        stopped: num(t.status) ? ms(t.stopDate) : null,
        start: START[num(t.start) ?? 0] ?? "inbox",
        when: decodeDay(t.startDate),
        evening: num(t.startBucket) === 1,
        deadline: decodeDay(t.deadline),
        area: idOf(t.area),
        todayIndex: todayIndex.get(t),
        tags: tagsOf(data.TMTaskTag, "tasks", t.uuid),
        created: ms(t.creationDate) ?? 0,
      };
      if (type === 1) make("project", t.uuid, task);
      else
        make("todo", t.uuid, {
          ...task,
          project: idOf(project),
          heading: idOf(heading),
          reminder: decodeTime(t.reminderTime),
          ...(rule && {
            repeat: rule,
            next: decodeDay(t.rt1_nextInstanceStartDate),
            start: "anytime",
            when: null,
          }),
          template: idOf(t.rt1_repeatingTemplate),
        });
    }

    const checklistKeys = keysInOrder(data.TMChecklistItem, (r) => num(r.index));
    for (const c of data.TMChecklistItem)
      make("checklist", c.uuid, {
        title: str(c.title) ?? "",
        todo: idOf(c.task),
        done: num(c.status) === 3 || num(c.status) === 2,
        index: checklistKeys.get(c),
      });
    return out;
  };

const packDay = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return (y! << 16) | (m! << 12) | (d! << 7);
};

/**
 * Counts taken straight from Things' rows with Things' own rules, independent of the import, so an
 * import can be checked against the source: areas, projects, to-dos, Today, Inbox and Logbook.
 */
export function thingsCounts(data: ThingsData, today: Day) {
  const tasks = data.TMTask;
  const byUuid = new Map(tasks.map((t) => [t.uuid, t]));
  const todayPacked = packDay(today);
  const live = (t: Row) => t.trashed !== 1 && !str(t.rt1_recurrenceRule);
  const projectOf = (t: Row) => {
    const p = str(t.project) ?? str(byUuid.get(t.heading)?.project);
    return p ? byUuid.get(p) : undefined;
  };
  const parentActive = (t: Row) => {
    const p = projectOf(t);
    return !p || (p.status === 0 && p.trashed !== 1 && p.start !== 2);
  };
  const open = (t: Row) =>
    live(t) && t.status === 0 && (t.type === 0 || t.type === 1) && parentActive(t);
  const startDate = (t: Row) => num(t.startDate) ?? 0;
  const deadline = (t: Row) => num(t.deadline) ?? 0;
  return {
    areas: data.TMArea.length,
    projects: tasks.filter((t) => t.type === 1 && live(t)).length,
    openProjects: tasks.filter((t) => t.type === 1 && live(t) && t.status === 0).length,
    todos: tasks.filter((t) => t.type === 0 && live(t)).length,
    today: tasks.filter(
      (t) =>
        open(t) &&
        t.start !== 2 &&
        ((t.start === 1 && startDate(t) > 0 && startDate(t) <= todayPacked) ||
          (deadline(t) > 0 && deadline(t) <= todayPacked)),
    ).length,
    inbox: tasks.filter(
      (t) => t.type === 0 && open(t) && t.start === 0 && !projectOf(t) && !str(t.area),
    ).length,
    logbook: tasks.filter(
      (t) =>
        live(t) &&
        (t.type === 0 || t.type === 1) &&
        t.status !== 0 &&
        (t.type === 1 || projectOf(t)?.status !== t.status),
    ).length,
  };
}
