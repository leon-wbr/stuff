import { describe, expect, it } from "vitest";
import { hlc } from "./hlc";
import { list, world, type ListId } from "./lists";
import type { Ctx } from "./ops";
import { decodeDay, decodeRule, decodeTime, importThings, thingsCounts } from "./things";
import { pack, rule, thingsFixture } from "./things.fixture";

const TODAY = "2026-11-23";
const T = 1_790_000_000;

const data = thingsFixture({
  TMArea: [
    { uuid: "A2", title: "Work", index: 2 },
    { uuid: "A1", title: "Home", index: 1 },
  ],
  TMTag: [
    { uuid: "G1", title: "Errand", index: 1, shortcut: "e" },
    { uuid: "G2", title: "Shops", parent: "G1", index: 2 },
  ],
  TMTask: [
    {
      uuid: "P1",
      type: 1,
      title: "Move flat",
      notes: "boxes",
      status: 0,
      trashed: 0,
      start: 1,
      area: "A1",
      index: 1,
      deadline: pack("2026-12-20"),
      creationDate: T,
    },
    {
      uuid: "P2",
      type: 1,
      title: "Old project",
      status: 3,
      stopDate: T + 50,
      trashed: 0,
      start: 1,
      area: "A2",
      index: 2,
    },
    {
      uuid: "H1",
      type: 2,
      title: "Packing",
      status: 0,
      trashed: 0,
      start: 1,
      project: "P1",
      index: 1,
    },
    { uuid: "T1", type: 0, title: "Inbox thing", status: 0, trashed: 0, start: 0, index: 1 },
    {
      uuid: "T2",
      type: 0,
      title: "Today thing",
      status: 0,
      trashed: 0,
      start: 1,
      startDate: pack(TODAY),
      todayIndex: 2,
      index: 2,
      reminderTime: (9 << 26) | (30 << 20),
    },
    {
      uuid: "T3",
      type: 0,
      title: "Evening thing",
      status: 0,
      trashed: 0,
      start: 1,
      startDate: pack("2026-11-20"),
      startBucket: 1,
      todayIndex: 1,
      index: 3,
    },
    {
      uuid: "T4",
      type: 0,
      title: "Under heading",
      status: 0,
      trashed: 0,
      start: 1,
      heading: "H1",
      index: 4,
    },
    {
      uuid: "T5",
      type: 0,
      title: "Someday thing",
      status: 0,
      trashed: 0,
      start: 2,
      area: "A2",
      index: 5,
    },
    {
      uuid: "T6",
      type: 0,
      title: "Done thing",
      status: 3,
      stopDate: T + 100,
      trashed: 0,
      start: 1,
      project: "P1",
      index: 6,
    },
    {
      uuid: "T7",
      type: 0,
      title: "Cancelled thing",
      status: 2,
      stopDate: T + 90,
      trashed: 0,
      start: 1,
      index: 7,
    },
    { uuid: "T8", type: 0, title: "Binned", status: 0, trashed: 1, start: 0, index: 8 },
    {
      uuid: "T9",
      type: 0,
      title: "Later",
      status: 0,
      trashed: 0,
      start: 1,
      startDate: pack("2026-12-02"),
      index: 9,
      area: "A1",
    },
    {
      uuid: "R0",
      type: 0,
      title: "Water plants",
      status: 0,
      trashed: 0,
      start: 1,
      index: 10,
      rt1_recurrenceRule: rule(256, 1, 0),
      rt1_nextInstanceStartDate: pack("2026-11-30"),
    },
    {
      uuid: "R1",
      type: 0,
      title: "Water plants",
      status: 0,
      trashed: 0,
      start: 1,
      startDate: pack(TODAY),
      index: 11,
      rt1_repeatingTemplate: "R0",
    },
  ],
  TMTaskTag: [{ tasks: "T2", tags: "G2" }],
  TMAreaTag: [{ areas: "A2", tags: "G1" }],
  TMChecklistItem: [
    { uuid: "C1", title: "tape", status: 3, task: "T4", index: 1 },
    { uuid: "C2", title: "boxes", status: 0, task: "T4", index: 0 },
  ],
});

function imported() {
  let n = 0;
  const ctx: Ctx = {
    docs: new Map(),
    clock: hlc("i", () => 1),
    id: () => `n${(++n).toString().padStart(4, "0")}`,
    now: 0,
    today: TODAY,
  };
  const docs = importThings(data)(ctx);
  return { docs, w: world(docs) };
}

const titles = (id: ListId) => {
  const { w } = imported();
  return list(w, id, TODAY).map((s) => s.items.map((t) => t.title));
};

describe("Things dates", () => {
  it("decodes packed day integers", () => {
    expect(decodeDay(pack("2026-11-23"))).toBe("2026-11-23");
    expect(decodeDay(132722176)).toBe("2025-02-28");
    expect(decodeDay(null)).toBeNull();
    expect(decodeDay(0)).toBeNull();
  });

  it("decodes packed reminder times", () => {
    expect(decodeTime((9 << 26) | (30 << 20))).toBe("09:30");
    expect(decodeTime((18 << 26) | (5 << 20))).toBe("18:05");
    expect(decodeTime(null)).toBeNull();
  });

  it("reads repeat rules from the plist", () => {
    expect(decodeRule(rule(256, 2, 0))).toEqual({ mode: "schedule", every: 2, unit: "week" });
    expect(decodeRule(rule(16, 3, 1))).toEqual({ mode: "after", every: 3, unit: "day" });
    expect(decodeRule(rule(8, 1, 0))).toEqual({ mode: "schedule", every: 1, unit: "month" });
    expect(decodeRule(rule(4, 1, 0))).toEqual({ mode: "schedule", every: 1, unit: "year" });
    expect(decodeRule("<plist/>")).toBeNull();
  });
});

describe("Things import", () => {
  it("brings areas over in Things' order, with their tags", () => {
    const { w } = imported();
    expect(w.areas.map((a) => a.title)).toEqual(["Home", "Work"]);
    expect(w.areas[1]!.tags.map((id) => (w.byId.get(id) as { title: string }).title)).toEqual([
      "Errand",
    ]);
  });

  it("keeps the tag tree", () => {
    const { w } = imported();
    const shops = w.tags.find((t) => t.title === "Shops")!;
    expect(w.byId.get(shops.parent!)).toMatchObject({ title: "Errand", shortcut: "e" });
  });

  it("fills Inbox, Today with This Evening, Upcoming, Someday and Logbook", () => {
    expect(titles("inbox")).toEqual([["Inbox thing"]]);
    expect(titles("today")).toEqual([["Today thing", "Water plants"], ["Evening thing"]]);
    expect(titles("upcoming")).toEqual([["Water plants"], ["Later"]]);
    expect(titles("someday")).toEqual([["Someday thing"]]);
    expect(titles("logbook")).toEqual([["Done thing", "Cancelled thing", "Old project"]]);
    expect(titles("trash")).toEqual([["Binned"]]);
  });

  it("puts to-dos under their project's headings, with notes, deadline and checklist", () => {
    const { w } = imported();
    const project = w.projects.find((p) => p.title === "Move flat")!;
    expect(project).toMatchObject({ notes: "boxes", deadline: "2026-12-20", created: T * 1000 });
    expect(titles(`project:${project.id}`)).toEqual([[], ["Under heading"]]);
    const todo = w.todos.find((t) => t.title === "Under heading")!;
    expect(w.checklist.filter((c) => c.todo === todo.id).map((c) => [c.title, c.done])).toEqual([
      ["boxes", false],
      ["tape", true],
    ]);
  });

  it("keeps reminders, tags, completion times and repeating templates", () => {
    const { w } = imported();
    const today = w.todos.find((t) => t.title === "Today thing")!;
    expect(today.reminder).toBe("09:30");
    expect(today.tags.map((id) => (w.byId.get(id) as { title: string }).title)).toEqual(["Shops"]);
    expect(w.todos.find((t) => t.title === "Done thing")!.stopped).toBe((T + 100) * 1000);
    const template = w.todos.find((t) => t.repeat)!;
    expect(template).toMatchObject({
      next: "2026-11-30",
      repeat: { mode: "schedule", unit: "week" },
    });
    expect(w.todos.find((t) => t.template === template.id)?.when).toBe(TODAY);
  });

  it("gives every object a fresh random-looking id, not Things' uuid", () => {
    const { docs } = imported();
    expect(docs.some((d) => /^[A-Z]\d$/.test(d.id))).toBe(false);
  });

  it("counts areas, projects and Today straight from the database to check an import", () => {
    expect(thingsCounts(data, TODAY)).toEqual({
      areas: 2,
      projects: 2,
      openProjects: 1,
      todos: 9,
      today: 3,
      inbox: 1,
      logbook: 3,
    });
  });
});
