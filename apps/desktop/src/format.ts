import { daysBetween, toDate } from "@stuff/core/days";
import type { Day } from "@stuff/core/model";

export function dayLabel(day: Day, today: Day) {
  const diff = daysBetween(today, day);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const date = toDate(day);
  if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) !== today.slice(0, 4) && { year: "numeric" }),
  });
}

export const monthLabel = (month: string) =>
  toDate(`${month}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function deadlineLabel(deadline: Day, today: Day) {
  const diff = daysBetween(today, deadline);
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} ago`;
  if (diff === 0) return "today";
  if (diff < 14) return `${diff} day${diff === 1 ? "" : "s"} left`;
  return dayLabel(deadline, today);
}

export const stoppedLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
