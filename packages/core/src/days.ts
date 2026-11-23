import type { Day } from "./model";

const two = (n: number) => String(n).padStart(2, "0");

export const dayOf = (date: Date): Day =>
  `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

export const toDate = (day: Day) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};

export const addDays = (day: Day, n: number): Day => {
  const date = toDate(day);
  date.setDate(date.getDate() + n);
  return dayOf(date);
};

/** Adds months, clamping to the month's last day (Jan 31 + 1 month = Feb 28). */
export const addMonths = (day: Day, n: number): Day => {
  const date = toDate(day);
  const target = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return dayOf(target);
};

export const isDay = (x: unknown): x is Day =>
  typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && dayOf(toDate(x)) === x;

export const daysBetween = (a: Day, b: Day) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
