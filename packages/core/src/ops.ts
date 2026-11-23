import { generateKeyBetween } from "fractional-indexing";
import { create, materialize, remove, update, type Doc, type Patch } from "./doc";
import type { Clock } from "./hlc";
import { list, world, type ListId, type Task, type World } from "./lists";
import {
  SETTINGS_ID,
  type Day,
  type Id,
  type Item,
  type Repeat,
  type Settings,
  type Status,
  type Todo,
  type Type,
} from "./model";
import { nextAfterCompletion } from "./repeat";

export interface Ctx {
  docs: Map<Id, Doc>;
  clock: Clock;
  id: () => Id;
  /** Unix ms. */
  now: number;
  today: Day;
}

/** An edit: reads the current documents and returns the ones it changed or created. */
export type Op = (ctx: Ctx) => Doc[];

export const randomId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

export type Where = ListId | "evening" | `day:${Day}` | `heading:${Id}`;

/** The fields an item gets when it's created in, or moved to, a list. */
export function placement(where: Where, today: Day, w?: World): Record<string, unknown> {
  if (where === "inbox")
    return { start: "inbox", when: null, evening: false, project: null, area: null, heading: null };
  if (where === "today") return { start: "anytime", when: today, evening: false };
  if (where === "evening") return { start: "anytime", when: today, evening: true };
  if (where === "anytime") return { start: "anytime", when: null, evening: false };
  if (where === "someday") return { start: "someday", when: null, evening: false };
  if (where === "upcoming") return { start: "anytime", when: today, evening: false };
  if (where.startsWith("day:")) return { start: "anytime", when: where.slice(4), evening: false };
  const [kind, id] = where.split(":") as [string, Id];
  if (kind === "area") return { area: id, project: null, heading: null };
  if (kind === "heading") {
    const h = w?.byId.get(id);
    return { project: h?.type === "heading" ? h.project : null, heading: id, area: null };
  }
  return { project: id, heading: null, area: null };
}

const fromInbox = (item: Item | undefined, fields: Record<string, unknown>) =>
  item && "start" in item && item.start === "inbox" && (fields.project || fields.area)
    ? { start: "anytime", ...fields }
    : fields;

const at = (ctx: Ctx, id: Id) => {
  const doc = ctx.docs.get(id);
  if (!doc) throw new Error(`No item ${id}`);
  return doc;
};

const item = <T extends Item>(ctx: Ctx, id: Id) => materialize<T>(at(ctx, id));

export const set =
  (ids: Id[], patch: Record<string, unknown>): Op =>
  (ctx) =>
    ids.map((id) => update(at(ctx, id), patch, ctx.clock));

const lastIndex = (items: { index: string }[]) =>
  items.reduce<string | null>((max, i) => (max === null || i.index > max ? i.index : max), null);

/** Adds an item of `type` at the end of `where`, or right after `after`. */
export const add =
  <K extends Type>(type: K, fields: Record<string, unknown>, where?: Where, after?: Id): Op =>
  (ctx) => {
    const w = world(ctx.docs.values());
    const siblings: { index: string }[] =
      type === "todo" || type === "project"
        ? [...w.todos, ...w.projects]
        : ((w as unknown as Record<string, { index: string }[]>)[
            type === "checklist" ? "checklist" : `${type}s`
          ] ?? []);
    const prev = after ? w.byId.get(after) : undefined;
    const prevIndex = prev && "index" in prev ? prev.index : lastIndex(siblings);
    const next =
      prev && "index" in prev
        ? siblings
            .filter((s) => s.index > prev.index)
            .reduce<string | null>(
              (min, s) => (min === null || s.index < min ? s.index : min),
              null,
            )
        : null;
    const id = ctx.id();
    return [
      create(
        type,
        id,
        {
          ...(type === "todo" || type === "project"
            ? { created: ctx.now, todayIndex: generateKeyBetween(null, null) }
            : {}),
          ...(where ? placement(where, ctx.today, w) : {}),
          index: generateKeyBetween(prevIndex, next),
          ...fields,
        } as unknown as Patch<K>,
        ctx.clock,
      ),
    ];
  };

/** Moves items to another list, the way dropping them on that list in the sidebar does. */
export const moveTo =
  (ids: Id[], where: Where): Op =>
  (ctx) => {
    const w = world(ctx.docs.values());
    const fields = placement(where, ctx.today, w);
    return ids.map((id) => {
      const it = w.byId.get(id);
      const patch =
        it?.type === "project" ? { ...fields, project: undefined, heading: undefined } : fields;
      if (it?.type === "project" && where.startsWith("project:")) return at(ctx, id);
      return update(at(ctx, id), fromInbox(it, patch), ctx.clock);
    });
  };

/** Puts `ids` between two neighbours in a list (either may be missing at the ends). */
export const reorder =
  (
    ids: Id[],
    before: Id | undefined,
    after: Id | undefined,
    field: "index" | "todayIndex" = "index",
  ): Op =>
  (ctx) => {
    const key = (id: Id | undefined) =>
      id ? ((item<Task>(ctx, id) as unknown as Record<string, string>)[field] ?? null) : null;
    let lo = key(before);
    const hi = key(after);
    return ids.map((id) => {
      const index = generateKeyBetween(lo, hi !== null && lo !== null && hi <= lo ? null : hi);
      lo = index;
      return update(at(ctx, id), { [field]: index }, ctx.clock);
    });
  };

/** Reorders by dropping `ids` in a rendered list at position `to` (an index into `order`). */
export function dropAt(order: Id[], ids: Id[], to: number) {
  const rest = order.filter((id) => !ids.includes(id));
  const before = order
    .slice(0, to)
    .filter((id) => !ids.includes(id))
    .at(-1);
  const after = rest[rest.indexOf(before ?? "") + 1] ?? (before ? undefined : rest[0]);
  return { before, after };
}

export const setStatus =
  (ids: Id[], status: Status): Op =>
  (ctx) =>
    ids.flatMap((id) => {
      const t = item<Task>(ctx, id);
      const next = t.status === status ? "open" : status;
      const done = update(
        at(ctx, id),
        { status: next, stopped: next === "open" ? null : ctx.now },
        ctx.clock,
      );
      const extra: Doc[] = [];
      if (t.type === "project" && next !== "open")
        for (const doc of ctx.docs.values()) {
          if (doc.deleted || doc.type !== "todo") continue;
          const child = materialize<Todo>(doc);
          if (child.project === id && child.status === "open" && !child.repeat)
            extra.push(update(doc, { status: next, stopped: ctx.now }, ctx.clock));
        }
      if (t.type === "todo" && t.template && next === "completed")
        extra.push(...spawnAfterCompletion(ctx, t.template));
      return [done, ...extra];
    });

function spawnAfterCompletion(ctx: Ctx, templateId: Id): Doc[] {
  const doc = ctx.docs.get(templateId);
  if (!doc || doc.deleted) return [];
  const template = materialize<Todo>(doc);
  if (!template.repeat || template.repeat.mode !== "after") return [];
  return [
    update(doc, { next: nextAfterCompletion(template.repeat as Repeat, ctx.today) }, ctx.clock),
  ];
}

export const trash =
  (ids: Id[], trashed = true): Op =>
  (ctx) =>
    ids.map((id) => update(at(ctx, id), { trashed }, ctx.clock));

/** Tombstones everything in the Trash, along with checklist items and headings of trashed parents. */
export const emptyTrash: Op = (ctx) => {
  const w = world(ctx.docs.values());
  const gone = new Set([...w.todos, ...w.projects].filter((t) => t.trashed).map((t) => t.id));
  for (const t of w.todos) if (t.project && gone.has(t.project)) gone.add(t.id);
  for (const h of w.headings) if (h.project && gone.has(h.project)) gone.add(h.id);
  for (const c of w.checklist) if (c.todo && gone.has(c.todo)) gone.add(c.id);
  return [...gone].map((id) => remove(at(ctx, id), ctx.clock));
};

export const destroy =
  (ids: Id[]): Op =>
  (ctx) =>
    ids.map((id) => remove(at(ctx, id), ctx.clock));

export const saveSettings =
  (patch: Partial<Settings>): Op =>
  (ctx) => {
    const doc = ctx.docs.get(SETTINGS_ID);
    return [
      doc ? update(doc, patch, ctx.clock) : create("settings", SETTINGS_ID, patch, ctx.clock),
    ];
  };

export const sectionsOf = (ctx: Ctx, id: ListId) => list(world(ctx.docs.values()), id, ctx.today);
