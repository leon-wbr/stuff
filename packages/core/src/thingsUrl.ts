import { checklistOf, type Task, type World } from "./lists";
import type { Day, Id, Project, Todo } from "./model";

/** Things' JSON URL scheme (culturedcode.com/things/support/articles/2803573). */
export interface ThingsItem {
  type: "to-do" | "project" | "heading" | "checklist-item";
  attributes: Record<string, unknown>;
}

const titleOf = (w: World, id: Id | null) => {
  const item = id ? w.byId.get(id) : undefined;
  return item && "title" in item ? item.title : undefined;
};

function when(t: Task, today: Day): string | undefined {
  if (t.start === "someday") return "someday";
  if (t.start === "inbox") return undefined;
  if (!t.when) return "anytime";
  if (t.when <= today) return t.evening ? "evening" : "today";
  return t.type === "todo" && t.reminder ? `${t.when}@${t.reminder}` : t.when;
}

function common(w: World, t: Task, today: Day) {
  const tags = t.tags.map((id) => titleOf(w, id)).filter(Boolean);
  return Object.fromEntries(
    Object.entries({
      title: t.title,
      notes: t.notes || undefined,
      when: when(t, today),
      deadline: t.deadline ?? undefined,
      tags: tags.length ? tags : undefined,
      completed: t.status === "completed" || undefined,
      canceled: t.status === "canceled" || undefined,
    }).filter(([, v]) => v !== undefined),
  );
}

function todo(w: World, t: Todo, today: Day, inProject: boolean): ThingsItem {
  const checklist = checklistOf(w, t.id).map((c) => ({
    type: "checklist-item" as const,
    attributes: { title: c.title, ...(c.done && { completed: true }) },
  }));
  const list = titleOf(w, t.project) ?? titleOf(w, t.area);
  const heading = titleOf(w, t.heading);
  return {
    type: "to-do",
    attributes: {
      ...common(w, t, today),
      ...(!inProject && list && { list }),
      ...(!inProject && t.project && heading && { heading }),
      ...(checklist.length && { "checklist-items": checklist }),
    },
  };
}

function project(w: World, p: Project, today: Day): ThingsItem {
  const todos = w.todos.filter((t) => t.project === p.id && !t.trashed && !t.repeat);
  const headings = w.headings.filter((h) => h.project === p.id && !h.trashed);
  const known = new Set(headings.map((h) => h.id));
  const items: ThingsItem[] = todos
    .filter((t) => !t.heading || !known.has(t.heading))
    .map((t) => todo(w, t, today, true));
  for (const h of headings) {
    items.push({ type: "heading", attributes: { title: h.title } });
    items.push(...todos.filter((t) => t.heading === h.id).map((t) => todo(w, t, today, true)));
  }
  const area = titleOf(w, p.area);
  return {
    type: "project",
    attributes: { ...common(w, p, today), ...(area && { area }), ...(items.length && { items }) },
  };
}

export function thingsItems(w: World, ids: Id[], today: Day): ThingsItem[] {
  return ids.flatMap((id) => {
    const item = w.byId.get(id);
    if (item?.type === "project") return [project(w, item, today)];
    if (item?.type === "todo") return [todo(w, item, today, false)];
    return [];
  });
}

export const thingsUrl = (w: World, ids: Id[], today: Day) =>
  `things:///json?reveal=true&data=${encodeURIComponent(JSON.stringify(thingsItems(w, ids, today)))}`;
