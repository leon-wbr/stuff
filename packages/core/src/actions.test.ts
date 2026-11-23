import { describe, expect, it } from "vitest";
import { asText, chain, convertToProject, duplicate, reopen } from "./actions";
import { hlc } from "./hlc";
import { checklistOf, list, world } from "./lists";
import { add, set, setStatus, type Ctx, type Op } from "./ops";

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
  const w = () => world(ctx.docs.values());
  const titles = (id: Parameters<typeof list>[1]) =>
    list(w(), id, TODAY).map((s) => s.items.map((i) => i.title));
  return { ctx, run, w, titles };
};

describe("duplicate", () => {
  it("copies each to-do with its checklist right after the original", () => {
    const { run, w, titles } = setup();
    const [a] = run(add("todo", { title: "a", notes: "n" }, "inbox"));
    run(add("todo", { title: "b" }, "inbox"));
    run(add("checklist", { title: "step", todo: a }));
    const [copy] = run(duplicate([a!]));
    expect(titles("inbox")).toEqual([["a", "a", "b"]]);
    expect(copy).not.toBe(a);
    expect(checklistOf(w(), copy!).map((c) => c.title)).toEqual(["step"]);
  });

  it("gives a copy of a finished to-do a fresh open status", () => {
    const { run, w } = setup();
    const [a] = run(add("todo", { title: "a" }, "inbox"));
    run(setStatus([a!], "completed"));
    const [copy] = run(duplicate([a!]));
    expect(w().byId.get(copy!)).toMatchObject({ status: "open", stopped: null });
  });
});

describe("reopen", () => {
  it("reopens completed and canceled items and leaves open ones alone", () => {
    const { run, w } = setup();
    const [a] = run(add("todo", { title: "a" }, "inbox"));
    const [b] = run(add("todo", { title: "b" }, "inbox"));
    const [c] = run(add("todo", { title: "c" }, "inbox"));
    run(setStatus([a!], "completed"));
    run(setStatus([b!], "canceled"));
    expect(run(reopen([a!, b!, c!]))).toEqual([a, b]);
    for (const id of [a, b, c]) expect(w().byId.get(id!)).toMatchObject({ status: "open" });
  });
});

describe("convertToProject", () => {
  it("turns a to-do into a project in its place, with its checklist as to-dos", () => {
    const { run, w, titles } = setup();
    const [area] = run(add("area", { title: "Home" }));
    const [t] = run(
      add("todo", { title: "Move", notes: "big", deadline: "2026-12-01" }, `area:${area}`),
    );
    run(add("checklist", { title: "boxes", todo: t }));
    run(add("checklist", { title: "van", todo: t, done: true }));
    const changed = run(convertToProject(t!));
    const project = w().projects[0]!;
    expect(project).toMatchObject({ title: "Move", notes: "big", deadline: "2026-12-01", area });
    expect(w().byId.has(t!)).toBe(false);
    expect(changed[0]).toBe(project.id);
    expect(titles(`project:${project.id}`)).toEqual([["boxes"]]);
    expect(w().todos.find((x) => x.title === "van")).toMatchObject({
      status: "completed",
      project: project.id,
    });
    expect(w().checklist).toEqual([]);
  });

  it("leaves to-dos inside a project alone", () => {
    const { run } = setup();
    const [p] = run(add("project", { title: "P" }));
    const [t] = run(add("todo", { title: "x" }, `project:${p}`));
    expect(run(convertToProject(t!))).toEqual([]);
  });
});

describe("chain", () => {
  it("runs ops in turn as one edit, each seeing the last one's result, without touching ctx", () => {
    const { ctx, run, w } = setup();
    const [a] = run(add("todo", { title: "a" }, "inbox"));
    const before = new Map(ctx.docs);
    const op = chain(set([a!], { title: "b" }), (c) =>
      set([a!], { notes: `was ${c.docs.get(a!)!.f.title!.v}` })(c),
    );
    const changed = op(ctx);
    expect(ctx.docs).toEqual(before);
    expect(changed.map((d) => d.id)).toEqual([a]);
    run(() => changed);
    expect(w().byId.get(a!)).toMatchObject({ title: "b", notes: "was b" });
  });
});

describe("asText", () => {
  it("writes items as a Markdown task list with notes and checklists", () => {
    const { run, w } = setup();
    const [a] = run(add("todo", { title: "Call", notes: "about the boiler" }, "inbox"));
    const [b] = run(add("todo", { title: "Shop" }, "inbox"));
    run(add("checklist", { title: "milk", todo: b, done: true }));
    run(setStatus([b!], "completed"));
    expect(asText(w(), [a!, b!])).toBe("- [ ] Call\n  about the boiler\n- [x] Shop\n  - [x] milk");
  });
});
