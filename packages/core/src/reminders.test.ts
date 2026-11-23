import { describe, expect, it } from "vitest";
import { worldOf } from "./lists";
import { DEFAULTS, type Item } from "./model";
import { dueReminders, reminderAt } from "./reminders";

const todo = (f: Partial<Item>) =>
  ({
    ...DEFAULTS.todo,
    id: Math.random().toString(),
    type: "todo",
    start: "anytime",
    ...f,
  }) as Item;
const at = (s: string) => new Date(s).getTime();

describe("reminders", () => {
  it("fires at the when date and reminder time, local", () => {
    expect(reminderAt(todo({ when: "2026-11-23", reminder: "09:30" }) as never)).toBe(
      at("2026-11-23T09:30:00"),
    );
    expect(reminderAt(todo({ when: "2026-11-23", reminder: null }) as never)).toBeNull();
  });

  it("finds open reminders due since the last check", () => {
    const w = worldOf([
      todo({ title: "due", when: "2026-11-23", reminder: "09:30" }),
      todo({ title: "earlier", when: "2026-11-23", reminder: "08:00" }),
      todo({ title: "later", when: "2026-11-23", reminder: "11:00" }),
      todo({ title: "done", when: "2026-11-23", reminder: "09:15", status: "completed" }),
    ]);
    expect(
      dueReminders(w, at("2026-11-23T09:00:00"), at("2026-11-23T10:00:00")).map((t) => t.title),
    ).toEqual(["due"]);
  });
});
