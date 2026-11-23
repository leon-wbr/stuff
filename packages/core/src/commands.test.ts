import { describe, expect, it } from "vitest";
import { commandOp, commands, parseArgs, runCommand } from "./commands";
import { hlc } from "./hlc";
import type { Ctx } from "./ops";

const TODAY = "2026-11-23";

function setup() {
  let n = 0;
  const ctx: Ctx = {
    docs: new Map(),
    clock: hlc("a", () => 1000),
    id: () => `id${String(++n).padStart(6, "0")}`,
    now: 5000,
    today: TODAY,
  };
  const run = (name: string, args: Record<string, unknown> = {}) => {
    const { docs, result } = runCommand(ctx, name, args);
    for (const d of docs) ctx.docs.set(d.id, d);
    return result as any;
  };
  return { ctx, run };
}

const titles = (r: { sections: { items: { title: string }[] }[] }) =>
  r.sections.flatMap((s) => s.items.map((i) => i.title));

describe("commands", () => {
  it("adds a to-do with notes, dates, tags, project, heading and checklist", () => {
    const { run } = setup();
    run("add", { title: "Errand", type: "tag" });
    const area = run("add", { title: "Home", type: "area" });
    run("add", { title: "Kitchen", type: "project", area: "home" });
    run("add", { title: "Build", type: "heading", project: "Kitchen" });
    const todo = run("add", {
      title: "Buy bulbs",
      notes: "E27",
      when: "today",
      deadline: "2026-11-30",
      tags: ["errand"],
      project: "kitchen",
      heading: "Build",
      checklist: ["warm white", "dimmable"],
    });
    const shown = run("show", { ref: todo.id });
    expect(shown).toMatchObject({
      title: "Buy bulbs",
      notes: "E27",
      when: TODAY,
      deadline: "2026-11-30",
      start: "anytime",
      tags: ["Errand"],
      project: { title: "Kitchen" },
      heading: { title: "Build" },
      checklist: [
        { title: "warm white", done: false },
        { title: "dimmable", done: false },
      ],
    });
    expect(area.type).toBe("area");
    expect(titles(run("list", { list: "today" }))).toEqual(["Buy bulbs"]);
    expect(titles(run("list", { project: "Kitchen" }))).toEqual(["Buy bulbs"]);
  });

  it("puts a bare to-do in the Inbox and lists it", () => {
    const { run } = setup();
    run("add", { title: "Call the plumber" });
    run("add", { title: "Someday thing", when: "someday" });
    run("add", { title: "Next week", when: "2026-11-30" });
    expect(titles(run("list", { list: "inbox" }))).toEqual(["Call the plumber"]);
    expect(titles(run("list", { list: "someday" }))).toEqual(["Someday thing"]);
    expect(titles(run("list", { list: "upcoming" }))).toEqual(["Next week"]);
  });

  it("completes, reopens, cancels, moves and deletes by id prefix or title", () => {
    const { run } = setup();
    const a = run("add", { title: "Water plants" });
    run("add", { title: "Kitchen", type: "project" });
    run("complete", { refs: [a.id.slice(0, 8)] });
    run("complete", { refs: [a.id] });
    expect(run("show", { ref: a.id }).status).toBe("completed");
    run("reopen", { refs: ["water plants"] });
    expect(run("show", { ref: a.id }).status).toBe("open");
    run("cancel", { refs: [a.id], toggle: true });
    run("cancel", { refs: [a.id], toggle: true });
    expect(run("show", { ref: a.id }).status).toBe("open");
    run("move", { refs: [a.id], to: "Kitchen" });
    expect(titles(run("list", { project: "Kitchen" }))).toEqual(["Water plants"]);
    run("move", { refs: [a.id], to: "evening" });
    expect(run("list", { list: "today" }).sections.at(-1).key).toBe("evening");
    run("delete", { refs: [a.id] });
    expect(titles(run("list", { list: "trash" }))).toEqual(["Water plants"]);
    run("delete", { refs: [a.id], permanent: true });
    expect(() => run("show", { ref: a.id })).toThrow(/Nothing matches/);
  });

  it("edits fields and clears a deadline", () => {
    const { run } = setup();
    const a = run("add", { title: "Draft", deadline: "2026-12-01" });
    run("edit", { ref: a.id, title: "Draft the summary", notes: "short", deadline: "none" });
    expect(run("show", { ref: a.id })).toMatchObject({
      title: "Draft the summary",
      notes: "short",
      deadline: null,
    });
  });

  it("explains ambiguous and unknown references", () => {
    const { run } = setup();
    run("add", { title: "Same" });
    run("add", { title: "Same" });
    expect(() => run("complete", { refs: ["same"] })).toThrow(/matches 2 items/);
    expect(() => run("add", { title: "x", tags: ["nope"] })).toThrow(/No tag "nope"/);
  });

  it("searches and filters lists by tag and text", () => {
    const { run } = setup();
    run("add", { title: "Calls", type: "tag" });
    run("add", { title: "Call grandma", tags: ["Calls"], when: "today" });
    run("add", { title: "Buy milk", when: "today" });
    expect(titles(run("list", { list: "today", tag: "Calls" }))).toEqual(["Call grandma"]);
    expect(titles(run("list", { list: "today", query: "milk" }))).toEqual(["Buy milk"]);
    expect(run("search", { query: "gran" })[0]).toMatchObject({
      kind: "todo",
      title: "Call grandma",
    });
  });

  it("parses command-line arguments from each command's spec", () => {
    const add = commands.find((c) => c.name === "add")!;
    expect(
      parseArgs(add, [
        "Buy milk",
        "--when",
        "today",
        "--checklist",
        "a",
        "--checklist",
        "b",
        "--tags",
        "x,y",
      ]),
    ).toEqual({ title: "Buy milk", when: "today", checklist: ["a", "b"], tags: ["x", "y"] });
    const del = commands.find((c) => c.name === "delete")!;
    expect(parseArgs(del, ["abc123", "def456", "--permanent"])).toEqual({
      refs: ["abc123", "def456"],
      permanent: true,
    });
    expect(() => parseArgs(add, [])).toThrow(/title is required/);
    expect(() => parseArgs(add, ["x", "--colour", "red"])).toThrow(/Unknown option --colour/);
    expect(() => parseArgs(add, ["x", "--when", "soonish"])).toThrow(/--when/);
  });

  it("turns a write command into an op for shortcuts and menus", () => {
    const { ctx, run } = setup();
    const a = run("add", { title: "x" });
    const [doc] = commandOp("complete", { refs: [a.id] })(ctx);
    expect(doc!.f.status!.v).toBe("completed");
  });
});
