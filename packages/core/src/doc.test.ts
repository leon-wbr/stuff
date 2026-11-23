import { describe, expect, it } from "vitest";
import { create, equal, materialize, merge, parseDoc, remove, update } from "./doc";
import { hlc } from "./hlc";
import type { Todo } from "./model";

const clocks = () => {
  let t = 1000;
  const wall = () => t;
  return { a: hlc("a", wall), b: hlc("b", wall), tick: () => void (t += 10) };
};

describe("documents", () => {
  it("materializes defaults for fields never written", () => {
    const { a } = clocks();
    const todo = materialize(create("todo", "t1", { title: "Milk" }, a));
    expect(todo).toMatchObject({ id: "t1", type: "todo", title: "Milk", status: "open", tags: [] });
  });

  it("keeps both sides when two devices edit different fields of one to-do", () => {
    const { a, b, tick } = clocks();
    const base = create("todo", "t1", { title: "Milk" }, a);
    tick();
    const onA = update(base, { title: "Oat milk" }, a);
    const onB = update(base, { notes: "2 litres" }, b);
    const ab = merge(onA, onB);
    const ba = merge(onB, onA);
    expect(materialize(ab)).toMatchObject({ title: "Oat milk", notes: "2 litres" });
    expect(equal(ab, ba)).toBe(true);
  });

  it("lets the later write win when both edit the same field", () => {
    const { a, b, tick } = clocks();
    const base = create("todo", "t1", { title: "x" }, a);
    tick();
    const first = update(base, { title: "first" }, a);
    tick();
    const second = update(base, { title: "second" }, b);
    expect(materialize<Todo>(merge(first, second)).title).toBe("second");
    expect(materialize<Todo>(merge(second, first)).title).toBe("second");
  });

  it("is idempotent", () => {
    const { a } = clocks();
    const doc = update(create("todo", "t1", { title: "x" }, a), { notes: "n" }, a);
    expect(equal(merge(doc, doc), doc)).toBe(true);
  });

  it("keeps a deletion even against a later edit", () => {
    const { a, b, tick } = clocks();
    const base = create("todo", "t1", { title: "x" }, a);
    const gone = remove(base, a);
    tick();
    const edited = update(base, { title: "y" }, b);
    expect(merge(gone, edited).deleted).toBe(true);
    expect(merge(edited, gone).deleted).toBe(true);
  });

  it("replays offline edits made in any order to the same result", () => {
    const { a, b, tick } = clocks();
    const base = create("todo", "t1", { title: "x" }, a);
    const edits = [];
    for (const [clock, patch] of [
      [a, { title: "1" }],
      [b, { notes: "n" }],
      [a, { deadline: "2026-12-01" }],
      [b, { title: "2" }],
    ] as const) {
      tick();
      edits.push(update(base, patch, clock));
    }
    const forward = edits.reduce((d, e) => merge(d, e), base);
    const backward = [...edits].reverse().reduce((d, e) => merge(d, e), base);
    expect(equal(forward, backward)).toBe(true);
    expect(materialize(forward)).toMatchObject({ title: "2", notes: "n", deadline: "2026-12-01" });
  });

  it("advances the local clock past stamps it merges in", () => {
    const fast = hlc("b", () => 9_000_000);
    const slow = hlc("a", () => 1000);
    const remote = create("todo", "t1", { title: "remote" }, fast);
    const merged = merge(undefined, remote, slow);
    expect(materialize<Todo>(update(merged, { title: "local" }, slow)).title).toBe("local");
  });

  it("rejects payloads that aren't documents", () => {
    expect(parseDoc({ id: "x", type: "todo", f: { title: { v: "a", c: "1" } } })).toBeTruthy();
    expect(parseDoc({ id: "x", type: "spaceship", f: {} })).toBeUndefined();
    expect(parseDoc({ id: 3, type: "todo", f: {} })).toBeUndefined();
    expect(parseDoc({ id: "x", type: "todo", f: { title: "a" } })).toBeUndefined();
    expect(parseDoc("nope")).toBeUndefined();
  });
});
