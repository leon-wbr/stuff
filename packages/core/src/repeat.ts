import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { generateKeyBetween } from "fractional-indexing";
import { addDays, addMonths } from "./days";
import { create, materialize, remove, update, type Doc } from "./doc";
import type { ChecklistItem, Day, Id, Repeat, Todo } from "./model";
import type { Ctx, Op } from "./ops";

export function advance(day: Day, r: Repeat): Day {
  if (r.unit === "day") return addDays(day, r.every);
  if (r.unit === "week") return addDays(day, 7 * r.every);
  return addMonths(day, r.unit === "month" ? r.every : 12 * r.every);
}

export const nextAfterCompletion = (r: Repeat, completed: Day) => advance(completed, r);

/** Derived ids: every device spawns the same instance for the same template and date. */
const derivedId = (...parts: string[]) =>
  bytesToHex(sha256(utf8ToBytes(parts.join(":")))).slice(0, 32);

const COPIED = [
  "title",
  "notes",
  "tags",
  "project",
  "area",
  "heading",
  "evening",
  "reminder",
] as const;

/** Turns a to-do into the first instance of a new hidden template carrying the rule. */
export const makeRepeating =
  (id: Id, repeat: Repeat): Op =>
  (ctx) => {
    const doc = ctx.docs.get(id)!;
    const todo = materialize<Todo>(doc);
    const templateId = ctx.id();
    const fields = Object.fromEntries(COPIED.map((k) => [k, todo[k]]));
    const next = repeat.mode === "schedule" ? advance(todo.when ?? ctx.today, repeat) : null;
    const template = create(
      "todo",
      templateId,
      { ...fields, start: "anytime", repeat, next, index: todo.index, created: ctx.now },
      ctx.clock,
    );
    const checklist = [...ctx.docs.values()]
      .filter((d) => !d.deleted && d.type === "checklist")
      .map((d) => materialize<ChecklistItem>(d))
      .filter((c) => c.todo === id && !c.trashed)
      .map((c) =>
        create(
          "checklist",
          ctx.id(),
          { title: c.title, todo: templateId, index: c.index },
          ctx.clock,
        ),
      );
    return [
      template,
      ...checklist,
      update(
        doc,
        { template: templateId, start: "anytime", when: todo.when ?? ctx.today },
        ctx.clock,
      ),
    ];
  };

const instancesOf = (ctx: Ctx, templateId: Id) =>
  [...ctx.docs.values()].filter(
    (d) => !d.deleted && d.type === "todo" && materialize<Todo>(d).template === templateId,
  );

/** Stops a repeating to-do, given its template or an instance: removes the template and unlinks its instances. */
export const stopRepeating =
  (id: Id): Op =>
  (ctx) => {
    const todo = materialize<Todo>(ctx.docs.get(id)!);
    const templateId = todo.repeat ? id : todo.template;
    const template = templateId ? ctx.docs.get(templateId) : undefined;
    const linked = templateId ? instancesOf(ctx, templateId) : [ctx.docs.get(id)!];
    return [
      ...linked.map((d) => update(d, { template: null }, ctx.clock)),
      ...(template ? [remove(template, ctx.clock)] : []),
    ];
  };

/**
 * Sets the rule of a repeating to-do, given its template or an instance, by editing the template in
 * place; a plain to-do starts repeating. A fixed schedule continues from the latest instance's
 * date; after completion waits for the open instance to be done.
 */
export const setRepeat =
  (id: Id, repeat: Repeat): Op =>
  (ctx) => {
    const todo = materialize<Todo>(ctx.docs.get(id)!);
    const templateId = todo.repeat ? id : todo.template;
    const template = templateId ? ctx.docs.get(templateId) : undefined;
    if (!templateId || !template || template.deleted) return makeRepeating(id, repeat)(ctx);
    const instances = instancesOf(ctx, templateId).map((d) => materialize<Todo>(d));
    const latest = instances.reduce<Day>((max, t) => (t.when && t.when > max ? t.when : max), "");
    const waiting = instances.some((t) => t.status === "open" && !t.trashed);
    const next =
      repeat.mode === "schedule"
        ? advance(latest || ctx.today, repeat)
        : waiting
          ? null
          : advance(ctx.today, repeat);
    return [update(template, { repeat, next }, ctx.clock)];
  };

/** Creates the instances whose day has come and moves each template's next date on. */
export function spawnDue(ctx: Ctx): Doc[] {
  const out: Doc[] = [];
  const docs = [...ctx.docs.values()].filter((d) => !d.deleted);
  for (const doc of docs) {
    if (doc.type !== "todo") continue;
    const t = materialize<Todo>(doc);
    if (!t.repeat || !t.next || t.next > ctx.today || t.trashed || t.status !== "open") continue;
    let day = t.next;
    if (t.repeat.mode === "schedule")
      while (advance(day, t.repeat) <= ctx.today) day = advance(day, t.repeat);
    const id = derivedId(t.id, day);
    out.push(
      update(
        doc,
        { next: t.repeat.mode === "schedule" ? advance(day, t.repeat) : null },
        ctx.clock,
      ),
    );
    if (ctx.docs.has(id)) continue;
    const fields = Object.fromEntries(COPIED.map((k) => [k, t[k]]));
    out.push(
      create(
        "todo",
        id,
        {
          ...fields,
          start: "anytime",
          when: day,
          template: t.id,
          created: ctx.now,
          index: t.index,
          todayIndex: generateKeyBetween(null, null),
        },
        ctx.clock,
      ),
    );
    for (const c of docs) {
      if (c.type !== "checklist") continue;
      const item = materialize<ChecklistItem>(c);
      if (item.todo !== t.id || item.trashed) continue;
      out.push(
        create(
          "checklist",
          derivedId(id, c.id),
          { title: item.title, todo: id, index: item.index },
          ctx.clock,
        ),
      );
    }
  }
  return out;
}
