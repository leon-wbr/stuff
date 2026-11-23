import { describe, expect, it } from "vitest";
import { update } from "./doc";
import { hlc } from "./hlc";
import { world } from "./lists";
import { add, moveTo, set, setStatus, trash, type Ctx, type Op } from "./ops";
import { record, revert } from "./undo";

const setup = () => {
  let n = 0;
  let t = 1000;
  const ctx: Ctx = {
    docs: new Map(),
    clock: hlc("a", () => ++t),
    id: () => `id${++n}`,
    now: 5000,
    today: "2026-11-23",
  };
  /** Applies an op and returns its undo entry, the way the app machine does. */
  const run = (op: Op) => {
    const changed = op(ctx);
    const entry = record(ctx.docs, changed);
    for (const d of changed) ctx.docs.set(d.id, d);
    return entry;
  };
  const get = (id: string) => world(ctx.docs.values()).byId.get(id);
  return { ctx, run, get };
};

describe("undo", () => {
  it("puts back the fields an edit changed", () => {
    const { ctx, run, get } = setup();
    run(add("todo", { title: "a" }, "inbox"));
    const entry = run(moveTo(["id1"], "today"));
    run(revert(entry));
    expect(get("id1")).toMatchObject({ start: "inbox", when: null, title: "a" });
    expect(ctx.docs.get("id1")!.deleted).toBeUndefined();
  });

  it("undoes a delete and a completion", () => {
    const { run, get } = setup();
    run(add("todo", { title: "a" }, "inbox"));
    run(revert(run(trash(["id1"]))));
    expect(get("id1")).toMatchObject({ trashed: false });
    run(revert(run(setStatus(["id1"], "completed"))));
    expect(get("id1")).toMatchObject({ status: "open", stopped: null });
  });

  it("removes what an edit created", () => {
    const { run, get } = setup();
    run(revert(run(add("todo", { title: "a" }, "inbox"))));
    expect(get("id1")).toBeUndefined();
  });

  it("redoes by reverting the undo", () => {
    const { run, get } = setup();
    run(add("todo", { title: "a" }, "inbox"));
    const undo = run(revert(run(set(["id1"], { title: "b" }))));
    expect(get("id1")).toMatchObject({ title: "a" });
    run(revert(undo));
    expect(get("id1")).toMatchObject({ title: "b" });
  });

  it("keeps a field someone changed since, so undo never overwrites newer edits", () => {
    const { ctx, run, get } = setup();
    run(add("todo", { title: "a", notes: "x" }, "inbox"));
    const entry = run(set(["id1"], { title: "b", notes: "y" }));
    ctx.docs.set("id1", update(ctx.docs.get("id1")!, { notes: "synced" }, ctx.clock));
    run(revert(entry));
    expect(get("id1")).toMatchObject({ title: "a", notes: "synced" });
  });
});
