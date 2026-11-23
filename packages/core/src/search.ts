import { active, type ListId, type World } from "./lists";
import type { Id } from "./model";

export const BUILT_IN: { id: ListId; title: string }[] = [
  { id: "inbox", title: "Inbox" },
  { id: "today", title: "Today" },
  { id: "upcoming", title: "Upcoming" },
  { id: "anytime", title: "Anytime" },
  { id: "someday", title: "Someday" },
  { id: "logbook", title: "Logbook" },
  { id: "trash", title: "Trash" },
];

export type Hit =
  | { kind: "list"; id: ListId; title: string }
  | { kind: "area" | "project" | "tag" | "todo"; id: Id; title: string; done?: boolean };

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Quick Find: lists, areas, projects and tags first, then to-dos (open before finished). */
export function search(w: World, query: string, limit = 30): Hit[] {
  const q = fold(query.trim());
  if (!q) return [];
  const score = (title: string) => {
    const t = fold(title);
    return t.startsWith(q)
      ? 0
      : t.split(/\s+/).some((word) => word.startsWith(q))
        ? 1
        : t.includes(q)
          ? 2
          : -1;
  };
  const ranked: [number, Hit][] = [];
  const consider = (hit: Hit, base: number, extra = "") => {
    const s = score(hit.title);
    if (s >= 0) ranked.push([base + s, hit]);
    else if (extra && fold(extra).includes(q)) ranked.push([base + 3, hit]);
  };
  for (const l of BUILT_IN) consider({ kind: "list", ...l }, 0);
  for (const a of w.areas) if (!a.trashed) consider({ kind: "area", id: a.id, title: a.title }, 0);
  for (const p of w.projects)
    if (!p.trashed)
      consider(
        { kind: "project", id: p.id, title: p.title, done: p.status !== "open" },
        p.status === "open" ? 0 : 20,
      );
  for (const t of w.tags) consider({ kind: "tag", id: t.id, title: t.title }, 5);
  for (const t of w.todos) {
    if (t.trashed || t.repeat) continue;
    const open = active(w, t);
    consider(
      { kind: "todo", id: t.id, title: t.title, done: t.status !== "open" },
      open ? 10 : 30,
      t.notes,
    );
  }
  return ranked
    .sort((a, b) => a[0] - b[0])
    .slice(0, limit)
    .map(([, hit]) => hit);
}
