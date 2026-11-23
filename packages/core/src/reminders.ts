import { toDate } from "./days";
import { active, type World } from "./lists";
import type { Todo } from "./model";

/** When a to-do's reminder fires, in local time: its when date at its reminder time. */
export function reminderAt(t: Todo): number | null {
  if (!t.when || !t.reminder || t.start !== "anytime") return null;
  const [h, m] = t.reminder.split(":").map(Number);
  const date = toDate(t.when);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  return date.getTime();
}

/** Open to-dos whose reminder falls in `(from, to]`. */
export const dueReminders = (w: World, from: number, to: number) =>
  w.todos.filter((t) => {
    const at = reminderAt(t);
    return at !== null && at > from && at <= to && active(w, t);
  });
