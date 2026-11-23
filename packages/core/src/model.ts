import { DEFAULT_THEME } from "./theme";

export type Id = string;
/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;
export type Status = "open" | "completed" | "canceled";
/** Like Things: the Inbox, an active list (with or without a date) or Someday. */
export type Start = "inbox" | "anytime" | "someday";
export type Unit = "day" | "week" | "month" | "year";

export interface Repeat {
  /** `after`: the next one is due an interval after completing this one; `schedule`: on fixed dates. */
  mode: "after" | "schedule";
  every: number;
  unit: Unit;
}

interface Base {
  id: Id;
  trashed: boolean;
}

export interface Todo extends Base {
  type: "todo";
  title: string;
  notes: string;
  status: Status;
  stopped: number | null;
  start: Start;
  when: Day | null;
  evening: boolean;
  deadline: Day | null;
  area: Id | null;
  project: Id | null;
  heading: Id | null;
  index: string;
  todayIndex: string;
  tags: Id[];
  reminder: string | null;
  /** On a repeating template: the rule and the day of the next instance. Templates are hidden from lists. */
  repeat: Repeat | null;
  next: Day | null;
  /** On an instance: the template it came from. */
  template: Id | null;
  created: number;
}

export interface Project extends Omit<
  Todo,
  "type" | "project" | "heading" | "reminder" | "repeat" | "next" | "template"
> {
  type: "project";
}

export interface Heading extends Base {
  type: "heading";
  title: string;
  project: Id | null;
  index: string;
  archived: boolean;
}

export interface Area extends Base {
  type: "area";
  title: string;
  index: string;
  tags: Id[];
}

export interface Tag extends Base {
  type: "tag";
  title: string;
  parent: Id | null;
  index: string;
  shortcut: string;
}

export interface ChecklistItem extends Base {
  type: "checklist";
  title: string;
  todo: Id | null;
  done: boolean;
  index: string;
}

export interface RelaySetting {
  url: string;
  enabled: boolean;
}

export interface Settings extends Base {
  type: "settings";
  relays: RelaySetting[] | null;
  theme: "system" | "light" | "dark";
  themeName: string;
}

export type Item = Todo | Project | Heading | Area | Tag | ChecklistItem | Settings;
export type Type = Item["type"];
export type Fields<T extends Item> = Omit<T, "id" | "type">;
export type ItemOf<K extends Type> = Extract<Item, { type: K }>;

const task = {
  title: "",
  notes: "",
  status: "open",
  stopped: null,
  start: "inbox",
  when: null,
  evening: false,
  deadline: null,
  area: null,
  index: "a0",
  todayIndex: "a0",
  tags: [],
  created: 0,
  trashed: false,
} as const;

export const DEFAULTS: { [K in Type]: Fields<ItemOf<K>> } = {
  todo: {
    ...task,
    tags: [],
    project: null,
    heading: null,
    reminder: null,
    repeat: null,
    next: null,
    template: null,
  },
  project: { ...task, tags: [], start: "anytime" },
  heading: { title: "", project: null, index: "a0", archived: false, trashed: false },
  area: { title: "", index: "a0", tags: [], trashed: false },
  tag: { title: "", parent: null, index: "a0", shortcut: "", trashed: false },
  checklist: { title: "", todo: null, done: false, index: "a0", trashed: false },
  settings: { relays: null, theme: "system", themeName: DEFAULT_THEME, trashed: false },
};

export const SETTINGS_ID = "settings";
