import { describe, expect, it } from "vitest";
import { materialize } from "./doc";
import { hlc } from "./hlc";
import { list, world } from "./lists";
import {
  add,
  dropAt,
  emptyTrash,
  moveTo,
  reorder,
  setStatus,
  trash,
  type Ctx,
  type Op,
} from "./ops";

const TODAY = "2026-11-23";
const setup = () => {
  let n = 0;
  const ctx: Ctx = {
    docs: new Map(),
    clock: hlc("a", () => 1000),
    id: () => `id${++n}`,
    now: 5000,
    today: TODAY,
  };
  const run = (op: Op) => {
    const docs = op(ctx);
    for (const d of docs) ctx.docs.set(d.id, d);
    return docs.map((d) => d.id);
  };
  const titles = (id: Parameters<typeof list>[1]) =>
    list(world(ctx.docs.values()), id, TODAY).map((s) => s.items.map((i) => i.title));
  return { ctx, run, titles };
};

describe("editing", () => {
  it("adds to-dos at the end of a list, or right after another", () => {
    const { run, titles } = setup();
    const [a] = run(add("todo", { title: "a" }, "inbox"));
    run(add("todo", { title: "c" }, "inbox"));
    run(add("todo", { title: "b" }, "inbox", a));
    expect(titles("inbox")).toEqual([["a", "b", "c"]]);
  });

  it("places new to-dos by the list they're added in", () => {
    const { run, titles } = setup();
    run(add("todo", { title: "t" }, "today"));
    run(add("todo", { title: "e" }, "evening"));
    run(add("todo", { title: "s" }, "someday"));
    expect(titles("today")).toEqual([["t"], ["e"]]);
    expect(titles("someday")).toEqual([["s"]]);
  });

  it("moving an Inbox to-do into a project files it as Anytime", () => {
    const { run, titles } = setup();
    const [p] = run(add("project", { title: "P" }));
    const [t] = run(add("todo", { title: "x" }, "inbox"));
    run(moveTo([t!], `project:${p}`));
    expect(titles("inbox")).toEqual([[]]);
    expect(titles(`project:${p!}`)).toEqual([["x"]]);
  });

  it("reorders by writing one index between the neighbours", () => {
    const { run, titles } = setup();
    const ids = ["a", "b", "c", "d"].flatMap((title) => run(add("todo", { title }, "inbox")));
    const { before, after } = dropAt(ids, [ids[3]!], 1);
    const changed = run(reorder([ids[3]!], before, after));
    expect(changed).toEqual([ids[3]]);
    expect(titles("inbox")).toEqual([["a", "d", "b", "c"]]);
  });

  it("drops at the top and the bottom", () => {
    const { run, titles } = setup();
    const ids = ["a", "b", "c"].flatMap((title) => run(add("todo", { title }, "inbox")));
    const top = dropAt(ids, [ids[2]!], 0);
    run(reorder([ids[2]!], top.before, top.after));
    expect(titles("inbox")).toEqual([["c", "a", "b"]]);
    const order = ["c", "a", "b"].map((t) => ids["abc".indexOf(t)]!);
    const bottom = dropAt(order, [order[0]!], 3);
    run(reorder([order[0]!], bottom.before, bottom.after));
    expect(titles("inbox")).toEqual([["a", "b", "c"]]);
  });

  it("completing toggles and stamps the time; completing a project completes its to-dos", () => {
    const { ctx, run, titles } = setup();
    const [p] = run(add("project", { title: "P" }));
    const [t] = run(add("todo", { title: "x" }, `project:${p!}`));
    run(setStatus([p!], "completed"));
    expect(materialize(ctx.docs.get(t!)!)).toMatchObject({ status: "completed", stopped: 5000 });
    expect(titles("logbook").flat()).toEqual(["P"]);
    run(setStatus([t!], "completed"));
    expect(materialize(ctx.docs.get(t!)!)).toMatchObject({ status: "open", stopped: null });
  });

  it("empties the trash into tombstones, including a trashed project's contents", () => {
    const { ctx, run, titles } = setup();
    const [p] = run(add("project", { title: "P" }));
    const [t] = run(add("todo", { title: "x" }, `project:${p!}`));
    run(trash([p!]));
    expect(titles("trash")).toEqual([["P"]]);
    run(emptyTrash);
    expect(ctx.docs.get(p!)!.deleted && ctx.docs.get(t!)!.deleted).toBe(true);
    expect(titles("trash")).toEqual([]);
  });
});
