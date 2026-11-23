import { describe, expect, it } from "vitest";
import { areaProjects, childTags, list, progress, withTag, worldOf } from "./lists";
import { DEFAULTS, type Item } from "./model";

const TODAY = "2026-11-23";
let n = 0;
const todo = (f: Partial<Item> = {}) =>
  ({ ...DEFAULTS.todo, id: `t${++n}`, type: "todo", index: `a${n}`, ...f }) as Item;
const project = (f: Partial<Item> = {}) =>
  ({ ...DEFAULTS.project, id: `p${++n}`, type: "project", ...f }) as Item;
const titles = (sections: { items: { title: string }[] }[]) =>
  sections.map((s) => s.items.map((i) => i.title));

describe("lists", () => {
  it("Inbox holds open, unfiled to-dos in order", () => {
    const w = worldOf([
      todo({ title: "b", index: "a2" }),
      todo({ title: "a", index: "a1" }),
      todo({ title: "done", status: "completed" }),
      todo({ title: "filed", start: "anytime" }),
      todo({ title: "binned", trashed: true }),
    ]);
    expect(titles(list(w, "inbox", TODAY))).toEqual([["a", "b"]]);
  });

  it("Today has dated, due and overdue items, with This Evening last", () => {
    const w = worldOf([
      todo({ title: "today", start: "anytime", when: TODAY, todayIndex: "a1" }),
      todo({ title: "overdue", start: "anytime", when: "2026-11-01", todayIndex: "a0" }),
      todo({ title: "evening", start: "anytime", when: TODAY, evening: true }),
      todo({ title: "tomorrow", start: "anytime", when: "2026-11-24" }),
      todo({ title: "deadline", start: "anytime", deadline: TODAY }),
      project({ title: "proj", when: TODAY, todayIndex: "a2" }),
    ]);
    const [main, evening] = list(w, "today", TODAY);
    expect(main!.items.map((i) => i.title)).toEqual(["overdue", "today", "proj", "deadline"]);
    expect(evening).toMatchObject({ key: "evening", items: [{ title: "evening" }] });
  });

  it("Upcoming groups future dates by day, then by month", () => {
    const w = worldOf([
      todo({ title: "tomorrow", start: "anytime", when: "2026-11-24" }),
      todo({ title: "in a week", start: "anytime", when: "2026-11-29" }),
      todo({ title: "january", start: "anytime", when: "2027-01-15" }),
      todo({ title: "january too", start: "anytime", when: "2027-01-02" }),
    ]);
    const sections = list(w, "upcoming", TODAY);
    expect(sections.map((s) => s.key)).toEqual(["2026-11-24", "2026-11-29", "2027-01"]);
    expect(sections[2]!.items.map((i) => i.title)).toEqual(["january too", "january"]);
  });

  it("Upcoming shows the next date of repeating templates", () => {
    const w = worldOf([
      todo({
        title: "rent",
        start: "anytime",
        repeat: { mode: "schedule", every: 1, unit: "month" },
        next: "2026-12-01",
      }),
    ]);
    expect(titles(list(w, "upcoming", TODAY))).toEqual([["rent"]]);
    expect(titles(list(w, "anytime", TODAY))).toEqual([]);
  });

  it("Anytime groups loose to-dos, then each area and project", () => {
    const area = { ...DEFAULTS.area, id: "A", type: "area", title: "Home" } as Item;
    const p = project({ id: "P", title: "Kitchen", area: "A" });
    const w = worldOf([
      area,
      p,
      todo({ title: "loose", start: "anytime" }),
      todo({ title: "area todo", start: "anytime", area: "A" }),
      todo({ title: "proj todo", start: "anytime", project: "P" }),
      todo({ title: "later", start: "anytime", when: "2026-12-24" }),
      todo({ title: "maybe", start: "someday" }),
    ]);
    const sections = list(w, "anytime", TODAY);
    expect(sections.map((s) => s.title)).toEqual([undefined, "Home", "Kitchen"]);
    expect(titles(sections)).toEqual([["loose"], ["area todo", "Kitchen"], ["proj todo"]]);
  });

  it("hides to-dos of someday, finished or trashed projects from active lists", () => {
    const w = worldOf([
      project({ id: "S", start: "someday" }),
      project({ id: "D", status: "completed" }),
      todo({ title: "a", start: "anytime", project: "S" }),
      todo({ title: "b", start: "anytime", project: "D" }),
    ]);
    expect(titles(list(w, "anytime", TODAY))).toEqual([]);
  });

  it("Logbook lists finished items newest first; Trash lists trashed ones", () => {
    const w = worldOf([
      todo({ title: "old", status: "completed", stopped: 1 }),
      todo({ title: "new", status: "canceled", stopped: 2 }),
      todo({ title: "binned", trashed: true }),
    ]);
    expect(titles(list(w, "logbook", TODAY)).flat()).toEqual(["new", "old"]);
    expect(titles(list(w, "trash", TODAY)).flat()).toEqual(["binned"]);
  });

  it("a project lists to-dos without heading first, then each heading", () => {
    const w = worldOf([
      project({ id: "P", title: "Move" }),
      { ...DEFAULTS.heading, id: "H", type: "heading", title: "Packing", project: "P" } as Item,
      todo({ title: "under", project: "P", heading: "H", start: "anytime" }),
      todo({ title: "top", project: "P", start: "anytime" }),
      todo({ title: "done", project: "P", status: "completed" }),
    ]);
    const sections = list(w, "project:P", TODAY);
    expect(sections.map((s) => s.title)).toEqual([undefined, "Packing"]);
    expect(titles(sections)).toEqual([["top"], ["under"]]);
    expect(progress(w, "P")).toEqual({ done: 1, total: 3 });
  });

  it("keeps to-dos completed since the cut-off in place until they're logged", () => {
    const w = worldOf([
      todo({ title: "just done", status: "completed", stopped: 2000 }),
      todo({ title: "done yesterday", status: "completed", stopped: 500 }),
      todo({ title: "open" }),
    ]);
    w.keepDoneSince = 1000;
    expect(titles(list(w, "inbox", TODAY))).toEqual([["just done", "open"]]);
  });

  it("filters by a tag and its child tags", () => {
    const tag = (id: string, parent: string | null) =>
      ({ ...DEFAULTS.tag, id, type: "tag", title: id, parent }) as Item;
    const w = worldOf([
      tag("work", null),
      tag("calls", "work"),
      todo({ title: "a", tags: ["calls"] }),
      todo({ title: "b", tags: [] }),
    ]);
    expect(titles(withTag(list(w, "inbox", TODAY), w, "work"))).toEqual([["a"]]);
  });

  it("nests open projects under their area and child tags under their parent", () => {
    const tag = (id: string, parent: string | null, f: Partial<Item> = {}) =>
      ({ ...DEFAULTS.tag, id, type: "tag", title: id, parent, ...f }) as Item;
    const w = worldOf([
      { ...DEFAULTS.area, id: "home", type: "area", title: "Home" } as Item,
      { ...DEFAULTS.area, id: "empty", type: "area", title: "Empty" } as Item,
      project({ id: "paint", area: "home" }),
      project({ id: "done", area: "home", status: "completed" }),
      project({ id: "gone", area: "empty", trashed: true }),
      project({ id: "loose" }),
      tag("work", null),
      tag("calls", "work"),
      tag("old", "work", { trashed: true }),
      tag("leaf", null),
    ]);
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    expect(ids(areaProjects(w, "home"))).toEqual(["paint"]);
    expect(ids(areaProjects(w, "empty"))).toEqual([]);
    expect(ids(areaProjects(w, null))).toEqual(["loose"]);
    expect(ids(childTags(w, null))).toEqual(["work", "leaf"]);
    expect(ids(childTags(w, "work"))).toEqual(["calls"]);
    expect(ids(childTags(w, "leaf"))).toEqual([]);
  });
});
