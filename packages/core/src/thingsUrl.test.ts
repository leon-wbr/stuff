import { describe, expect, it } from "vitest";
import { worldOf } from "./lists";
import { DEFAULTS, type Item } from "./model";
import { thingsItems, thingsUrl } from "./thingsUrl";

const TODAY = "2026-11-23";
const w = worldOf([
  { ...DEFAULTS.area, id: "A", type: "area", title: "Home" },
  {
    ...DEFAULTS.project,
    id: "P",
    type: "project",
    title: "Move",
    area: "A",
    deadline: "2026-12-20",
    notes: "boxes",
  },
  { ...DEFAULTS.heading, id: "H", type: "heading", title: "Packing", project: "P", index: "a1" },
  { ...DEFAULTS.tag, id: "g", type: "tag", title: "Errand" },
  {
    ...DEFAULTS.todo,
    id: "t1",
    type: "todo",
    title: "Tape",
    project: "P",
    heading: "H",
    start: "anytime",
    tags: ["g"],
    index: "a2",
  },
  {
    ...DEFAULTS.todo,
    id: "t0",
    type: "todo",
    title: "Call landlord",
    project: "P",
    start: "anytime",
    when: TODAY,
    evening: true,
    index: "a0",
  },
  { ...DEFAULTS.checklist, id: "c", type: "checklist", title: "brown", todo: "t1", done: true },
  { ...DEFAULTS.todo, id: "x", type: "todo", title: "Milk", start: "someday" },
  {
    ...DEFAULTS.todo,
    id: "y",
    type: "todo",
    title: "Dentist",
    start: "anytime",
    when: "2026-12-01",
    reminder: "09:30",
    status: "completed",
  },
] as Item[]);

describe("hand-off to Things", () => {
  it("sends a project with its headings, to-dos and checklists in order", () => {
    expect(thingsItems(w, ["P"], TODAY)).toEqual([
      {
        type: "project",
        attributes: {
          title: "Move",
          notes: "boxes",
          deadline: "2026-12-20",
          when: "anytime",
          area: "Home",
          items: [
            { type: "to-do", attributes: { title: "Call landlord", when: "evening" } },
            { type: "heading", attributes: { title: "Packing" } },
            {
              type: "to-do",
              attributes: {
                title: "Tape",
                when: "anytime",
                tags: ["Errand"],
                "checklist-items": [
                  { type: "checklist-item", attributes: { title: "brown", completed: true } },
                ],
              },
            },
          ],
        },
      },
    ]);
  });

  it("maps someday, dates with reminders and completion for loose to-dos", () => {
    expect(thingsItems(w, ["x", "y"], TODAY)).toEqual([
      { type: "to-do", attributes: { title: "Milk", when: "someday" } },
      {
        type: "to-do",
        attributes: { title: "Dentist", when: "2026-12-01@09:30", completed: true },
      },
    ]);
  });

  it("names the project when a to-do is sent on its own", () => {
    expect(thingsItems(w, ["t1"], TODAY)[0]!.attributes).toMatchObject({
      list: "Move",
      heading: "Packing",
    });
  });

  it("builds an encoded things:///json URL", () => {
    const url = thingsUrl(w, ["x"], TODAY);
    expect(url.startsWith("things:///json?reveal=true&data=")).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.split("data=")[1]!))).toEqual(
      thingsItems(w, ["x"], TODAY),
    );
  });
});
