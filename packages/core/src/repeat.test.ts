import { describe, expect, it } from "vitest";
import { materialize } from "./doc";
import { hlc } from "./hlc";
import { world } from "./lists";
import type { Todo } from "./model";
import { add, setStatus, type Ctx } from "./ops";
import { advance, makeRepeating, spawnDue, stopRepeating } from "./repeat";

const ctxAt = (today: string, docs = new Map()): Ctx => {
  let n = 0;
  return {
    docs,
    clock: hlc("a", () => Date.parse(today)),
    id: () => `id${++n}`,
    now: Date.parse(today),
    today,
  };
};
const apply = (ctx: Ctx, docs: ReturnType<ReturnType<typeof add>>) => {
  for (const d of docs) ctx.docs.set(d.id, d);
  return docs;
};

describe("advance", () => {
  it("steps by days, weeks, months and years, clamping month ends", () => {
    expect(advance("2026-11-23", { mode: "schedule", every: 3, unit: "day" })).toBe("2026-11-26");
    expect(advance("2026-11-23", { mode: "schedule", every: 2, unit: "week" })).toBe("2026-12-07");
    expect(advance("2027-01-31", { mode: "schedule", every: 1, unit: "month" })).toBe("2027-02-28");
    expect(advance("2028-02-29", { mode: "schedule", every: 1, unit: "year" })).toBe("2029-02-28");
  });
});

describe("repeating to-dos", () => {
  it("on a fixed schedule, creates each instance on its date and keeps going", () => {
    const ctx = ctxAt("2026-11-23");
    const [todo] = apply(ctx, add("todo", { title: "Rent" }, "today")(ctx));
    apply(ctx, makeRepeating(todo!.id, { mode: "schedule", every: 1, unit: "week" })(ctx));
    const template = world(ctx.docs.values()).todos.find((t) => t.repeat)!;
    expect(template.next).toBe("2026-11-30");
    expect(spawnDue(ctxAt("2026-11-29", ctx.docs))).toEqual([]);

    const later = ctxAt("2026-11-30", ctx.docs);
    const spawned = apply(later, spawnDue(later));
    const instance = spawned.map((d) => materialize<Todo>(d)).find((t) => t.template);
    expect(instance).toMatchObject({ title: "Rent", when: "2026-11-30", template: template.id });
    expect(materialize<Todo>(ctx.docs.get(template.id)!).next).toBe("2026-12-07");
    expect(spawnDue(later)).toEqual([]);
  });

  it("gives two devices the same instance id, so syncing doesn't duplicate it", () => {
    const ctx = ctxAt("2026-11-23");
    const [todo] = apply(ctx, add("todo", { title: "Rent" }, "today")(ctx));
    apply(ctx, makeRepeating(todo!.id, { mode: "schedule", every: 1, unit: "day" })(ctx));
    const a = spawnDue(ctxAt("2026-11-24", new Map(ctx.docs)));
    const b = spawnDue(ctxAt("2026-11-24", new Map(ctx.docs)));
    expect(a.map((d) => d.id)).toEqual(b.map((d) => d.id));
  });

  it("after completion, schedules the next one from the day it was done", () => {
    const ctx = ctxAt("2026-11-23");
    const [todo] = apply(ctx, add("todo", { title: "Haircut" }, "today")(ctx));
    apply(ctx, makeRepeating(todo!.id, { mode: "after", every: 3, unit: "week" })(ctx));
    expect(spawnDue(ctxAt("2027-06-01", ctx.docs))).toEqual([]);

    const done = ctxAt("2026-11-25", ctx.docs);
    apply(done, setStatus([todo!.id], "completed")(done));
    const template = world(ctx.docs.values()).todos.find((t) => t.repeat)!;
    expect(template.next).toBe("2026-12-16");
    const due = ctxAt("2026-12-16", ctx.docs);
    expect(
      spawnDue(due)
        .map((d) => materialize<Todo>(d))
        .find((t) => t.template)?.when,
    ).toBe("2026-12-16");
  });

  it("copies the template's checklist into each instance", () => {
    const ctx = ctxAt("2026-11-23");
    const [todo] = apply(ctx, add("todo", { title: "Pack" }, "today")(ctx));
    apply(ctx, add("checklist", { title: "socks", todo: todo!.id })(ctx));
    apply(ctx, makeRepeating(todo!.id, { mode: "schedule", every: 1, unit: "day" })(ctx));
    const due = ctxAt("2026-11-24", ctx.docs);
    const items = apply(due, spawnDue(due)).map((d) => materialize(d));
    const instance = items.find((i) => i.type === "todo" && i.template)!;
    expect(items.filter((i) => i.type === "checklist" && i.todo === instance.id)).toHaveLength(1);
  });

  it("stopping removes the template and unlinks the instance", () => {
    const ctx = ctxAt("2026-11-23");
    const [todo] = apply(ctx, add("todo", { title: "x" }, "today")(ctx));
    apply(ctx, makeRepeating(todo!.id, { mode: "after", every: 1, unit: "day" })(ctx));
    apply(ctx, stopRepeating(todo!.id)(ctx));
    expect(world(ctx.docs.values()).todos.map((t) => [t.title, t.template, t.repeat])).toEqual([
      ["x", null, null],
    ]);
  });
});
