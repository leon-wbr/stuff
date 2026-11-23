import { addDays } from "./days";
import { materialize, type Doc } from "./doc";
import type {
  Area,
  ChecklistItem,
  Day,
  Heading,
  Id,
  Item,
  Project,
  Settings,
  Tag,
  Todo,
} from "./model";

export interface World {
  byId: Map<Id, Item>;
  todos: Todo[];
  projects: Project[];
  headings: Heading[];
  areas: Area[];
  tags: Tag[];
  checklist: ChecklistItem[];
  settings?: Settings;
  /** Items finished at or after this time (ms) stay in their lists until the day is over, like in Things. */
  keepDoneSince?: number;
}

export type Task = Todo | Project;
export type ListId =
  | "inbox"
  | "today"
  | "upcoming"
  | "anytime"
  | "someday"
  | "logbook"
  | "trash"
  | `project:${Id}`
  | `area:${Id}`;

export interface Section {
  key: string;
  title?: string;
  /** The project, area or heading this section stands for. */
  ref?: Id;
  items: Task[];
}

const byIndex = (a: { index: string }, b: { index: string }) =>
  a.index < b.index ? -1 : a.index > b.index ? 1 : 0;

export function worldOf(items: Iterable<Item>): World {
  const w: World = {
    byId: new Map(),
    todos: [],
    projects: [],
    headings: [],
    areas: [],
    tags: [],
    checklist: [],
  };
  for (const item of items) {
    w.byId.set(item.id, item);
    if (item.type === "todo") w.todos.push(item);
    else if (item.type === "project") w.projects.push(item);
    else if (item.type === "heading") w.headings.push(item);
    else if (item.type === "area") w.areas.push(item);
    else if (item.type === "tag") w.tags.push(item);
    else if (item.type === "checklist") w.checklist.push(item);
    else w.settings = item;
  }
  for (const list of [w.todos, w.projects, w.headings, w.areas, w.tags, w.checklist])
    list.sort(byIndex);
  return w;
}

export const world = (docs: Iterable<Doc>) =>
  worldOf([...docs].filter((d) => !d.deleted).map((d) => materialize(d)));

const get = <T extends Item>(w: World, id: Id | null, type: T["type"]) => {
  const item = id ? w.byId.get(id) : undefined;
  return item?.type === type ? (item as T) : undefined;
};

const isTemplate = (t: Task) => t.type === "todo" && t.repeat !== null;

/** Open, not trashed, not a repeating template, and inside an open, active project if any. */
export function active(w: World, t: Task) {
  const logged =
    t.status !== "open" && !(w.keepDoneSince !== undefined && (t.stopped ?? 0) >= w.keepDoneSince);
  if (logged || t.trashed || isTemplate(t)) return false;
  if (get<Area>(w, t.area, "area")?.trashed) return false;
  if (t.type === "project" || !t.project) return true;
  const p = get<Project>(w, t.project, "project");
  return !p || (p.status === "open" && !p.trashed && p.start !== "someday");
}

const tasks = (w: World): Task[] => [...w.todos, ...w.projects];

const dated = (t: Task, today: Day) => t.start === "anytime" && !!t.when && t.when <= today;

export const inToday = (w: World, t: Task, today: Day) =>
  active(w, t) &&
  t.start !== "someday" &&
  (dated(t, today) || (!!t.deadline && t.deadline <= today));

const todayOrder = (today: Day) => (a: Task, b: Task) =>
  Number(!dated(a, today)) - Number(!dated(b, today)) ||
  (a.todayIndex < b.todayIndex ? -1 : a.todayIndex > b.todayIndex ? 1 : byIndex(a, b));

function today(w: World, day: Day): Section[] {
  const items = tasks(w)
    .filter((t) => inToday(w, t, day))
    .sort(todayOrder(day));
  const evening = items.filter((t) => t.evening && dated(t, day));
  return [
    { key: "today", items: items.filter((t) => !evening.includes(t)) },
    ...(evening.length ? [{ key: "evening", title: "This Evening", items: evening }] : []),
  ];
}

function upcoming(w: World, day: Day): Section[] {
  const weekEnd = addDays(day, 7);
  const dateOf = (t: Task) => (isTemplate(t) ? (t as Todo).next : t.when);
  const items = tasks(w)
    .filter((t) => {
      const date = dateOf(t);
      if (!date || date <= day || t.trashed || t.status !== "open") return false;
      return isTemplate(t) || active(w, t);
    })
    .sort((a, b) => (dateOf(a)! < dateOf(b)! ? -1 : dateOf(a)! > dateOf(b)! ? 1 : byIndex(a, b)));
  const sections: Section[] = [];
  for (const t of items) {
    const date = dateOf(t)!;
    const key = date <= weekEnd ? date : date.slice(0, 7);
    const last = sections.at(-1);
    if (last?.key === key) last.items.push(t);
    else sections.push({ key, items: [t] });
  }
  return sections;
}

/** Loose items first, then for each area its loose items and projects, then each project's to-dos. */
function grouped(w: World, items: Task[]): Section[] {
  const loose = items.filter((t) => t.type === "project" || !t.project);
  const sections: Section[] = [];
  const push = (s: Section) => s.items.length && sections.push(s);
  push({ key: "loose", items: loose.filter((t) => !t.area) });
  const projectSection = (p: Project) =>
    push({
      key: p.id,
      ref: p.id,
      title: p.title,
      items: items.filter((t) => t.type === "todo" && t.project === p.id),
    });
  for (const p of w.projects.filter((p) => !p.area)) projectSection(p);
  for (const a of w.areas) {
    push({ key: a.id, ref: a.id, title: a.title, items: loose.filter((t) => t.area === a.id) });
    for (const p of w.projects.filter((p) => p.area === a.id)) projectSection(p);
  }
  return sections;
}

const logbook = (w: World): Section[] => {
  const items = tasks(w)
    .filter((t) => t.status !== "open" && !t.trashed && !isTemplate(t))
    .filter(
      (t) => t.type === "project" || get<Project>(w, t.project, "project")?.status !== t.status,
    )
    .sort((a, b) => (b.stopped ?? 0) - (a.stopped ?? 0));
  return items.length ? [{ key: "logbook", items }] : [];
};

function project(w: World, id: Id): Section[] {
  const todos = w.todos.filter((t) => t.project === id && active(w, t));
  const headings = w.headings.filter((h) => h.project === id && !h.trashed && !h.archived);
  const known = new Set(headings.map((h) => h.id));
  return [
    { key: "top", items: todos.filter((t) => !t.heading || !known.has(t.heading)) },
    ...headings.map((h) => ({
      key: h.id,
      ref: h.id,
      title: h.title,
      items: todos.filter((t) => t.heading === h.id),
    })),
  ];
}

function area(w: World, id: Id): Section[] {
  const mine = tasks(w).filter((t) => t.area === id && (t.type === "project" || !t.project));
  const open = mine.filter((t) => active(w, t));
  return [
    { key: "projects", items: open.filter((t) => t.type === "project") },
    { key: "todos", items: open.filter((t) => t.type === "todo" && t.start !== "someday") },
    {
      key: "someday",
      title: "Someday",
      items: open.filter((t) => t.type === "todo" && t.start === "someday"),
    },
  ].filter((s) => s.items.length);
}

export function list(w: World, id: ListId, day: Day): Section[] {
  const open = tasks(w).filter((t) => active(w, t));
  switch (id) {
    case "inbox":
      return [
        {
          key: "inbox",
          items: w.todos.filter(
            (t) => active(w, t) && t.start === "inbox" && !t.project && !t.area,
          ),
        },
      ];
    case "today":
      return today(w, day);
    case "upcoming":
      return upcoming(w, day);
    case "anytime":
      return grouped(
        w,
        open.filter((t) => t.start === "anytime" && (!t.when || t.when <= day)),
      );
    case "someday":
      return grouped(
        w,
        open.filter((t) => t.start === "someday"),
      );
    case "logbook":
      return logbook(w);
    case "trash": {
      const items = tasks(w).filter((t) => t.trashed);
      return items.length ? [{ key: "trash", items }] : [];
    }
  }
  const [kind, ref] = id.split(":") as ["project" | "area", Id];
  return kind === "project" ? project(w, ref) : area(w, ref);
}

export function progress(w: World, projectId: Id) {
  const todos = w.todos.filter((t) => t.project === projectId && !t.trashed && !isTemplate(t));
  return { done: todos.filter((t) => t.status !== "open").length, total: todos.length };
}

/** What the sidebar nests: open projects under an area (or loose with `null`). */
export const areaProjects = (w: World, area: Id | null) =>
  w.projects.filter((p) => p.area === area && p.status === "open" && !p.trashed);

/** Tags under a parent tag (or the top level with `null`). */
export const childTags = (w: World, parent: Id | null) =>
  w.tags.filter((t) => t.parent === parent && !t.trashed);

export function tagFamily(w: World, tagId: Id): Set<Id> {
  const family = new Set([tagId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of w.tags)
      if (t.parent && family.has(t.parent) && !family.has(t.id)) grew = !!family.add(t.id);
  }
  return family;
}

export function withTag(sections: Section[], w: World, tagId: Id): Section[] {
  const family = tagFamily(w, tagId);
  return sections
    .map((s) => ({ ...s, items: s.items.filter((t) => t.tags.some((id) => family.has(id))) }))
    .filter((s) => s.items.length);
}

export const checklistOf = (w: World, todoId: Id) =>
  w.checklist.filter((c) => c.todo === todoId && !c.trashed);
