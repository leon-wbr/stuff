import { describe, expect, it, vi } from "vitest";
import { createActor, waitFor } from "xstate";
import { create, materialize, update } from "./doc";
import { hlc } from "./hlc";
import { list, world } from "./lists";
import { appMachine, type Deps } from "./machine";
import { add } from "./ops";

function deps(over: Partial<Deps> = {}) {
  let push: (docs: unknown[]) => void = () => {};
  const d: Deps = {
    keyStatus: vi.fn(async () => null),
    saveKey: vi.fn(async () => "npub1test"),
    load: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    listen: (fn) => ((push = fn), () => {}),
    now: () => Date.parse("2026-11-23T10:00:00"),
    ...over,
  };
  return { d, push: (docs: unknown[]) => push(docs) };
}

const ready = (actor: ReturnType<typeof start>) =>
  waitFor(actor, (s) => s.matches({ data: "ready" }));
const start = (d: Deps) => createActor(appMachine(d)).start();

describe("app machine", () => {
  it("asks for a key when none is stored and saves a new one", async () => {
    const { d } = deps();
    const actor = start(d);
    await waitFor(actor, (s) => s.matches({ key: "missing" }));
    actor.send({ type: "key.create" });
    await waitFor(actor, (s) => s.matches({ key: "ready" }));
    expect(d.saveKey).toHaveBeenCalledWith("generate_key", undefined);
    expect(actor.getSnapshot().context.npub).toBe("npub1test");
  });

  it("shows the import error and stays on key setup", async () => {
    const { d } = deps({ saveKey: async () => Promise.reject("That is not a valid nsec") });
    const actor = start(d);
    await waitFor(actor, (s) => s.matches({ key: "missing" }));
    actor.send({ type: "key.import", nsec: "nope" });
    await waitFor(actor, (s) => !!s.context.keyError);
    expect(actor.getSnapshot().context.keyError).toBe("That is not a valid nsec");
  });

  it("loads stored documents, applies edits and saves them as dirty", async () => {
    const clock = hlc("x", () => 1);
    const stored = create("todo", "t1", { title: "stored", start: "inbox" }, clock);
    const { d } = deps({ load: async () => [stored, { junk: true }] });
    const actor = start(d);
    await ready(actor);
    actor.send({ type: "change", op: add("todo", { title: "new" }, "inbox") });
    const w = world(actor.getSnapshot().context.docs.values());
    expect(list(w, "inbox", "2026-11-23")[0]!.items.map((t) => t.title)).toEqual(["stored", "new"]);
    expect(d.save).toHaveBeenCalledWith([expect.objectContaining({ type: "todo" })], true);
  });

  it("merges documents from other windows and sync without saving them again", async () => {
    const clock = hlc("x", () => 1);
    const base = create("todo", "t1", { title: "a" }, clock);
    const { d, push } = deps({ load: async () => [base] });
    const actor = start(d);
    await ready(actor);
    push([
      update(
        base,
        { notes: "from elsewhere" },
        hlc("y", () => 2),
      ),
    ]);
    expect(materialize(actor.getSnapshot().context.docs.get("t1")!)).toMatchObject({
      title: "a",
      notes: "from elsewhere",
    });
    expect(d.save).not.toHaveBeenCalled();
  });

  it("reports a failing edit instead of crashing", async () => {
    const { d } = deps();
    const actor = start(d);
    await ready(actor);
    actor.send({
      type: "change",
      op: () => {
        throw new Error("No item x");
      },
    });
    expect(actor.getSnapshot().context.error).toBe("No item x");
  });
});
