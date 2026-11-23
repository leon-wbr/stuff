import { addDays, isDay, toDate } from "./days";
import type { Doc } from "./doc";
import { checklistOf, list, withTag, world, type ListId, type Section, type World } from "./lists";
import type { Id, Item, Type } from "./model";
import {
  add,
  destroy,
  moveTo,
  placement,
  set,
  setStatus,
  trash,
  type Ctx,
  type Op,
  type Where,
} from "./ops";
import { search } from "./search";

export type ArgType =
  | "string"
  /** Repeatable. */
  | "strings"
  /** Comma-separated or repeatable. */
  | "list"
  | "day"
  | "when"
  | "enum"
  | "ref"
  | "refs"
  | "boolean"
  | "number";

export interface ArgSpec {
  type: ArgType;
  summary: string;
  required?: boolean;
  /** Taken from the bare words on the command line (all of them for `refs`). */
  positional?: boolean;
  values?: readonly string[];
}

export type Args = Record<string, unknown>;

/** A named edit or query. Write commands return the documents they changed, like an `Op`. */
export interface CommandDef {
  name: string;
  summary: string;
  write: boolean;
  args: Record<string, ArgSpec>;
  run(ctx: Ctx, args: Args): { docs?: Doc[]; result?: unknown };
}

const WHEN = ["today", "evening", "tomorrow", "anytime", "someday", "inbox"] as const;
const LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"] as const;
const TYPES = ["todo", "project", "area", "heading", "tag"] as const;

const valid: Partial<Record<ArgType, (v: string) => boolean>> = {
  when: (v) => (WHEN as readonly string[]).includes(v) || isDay(v),
  day: (v) => ["today", "tomorrow", "none"].includes(v) || isDay(v),
  number: (v) => /^\d+$/.test(v),
};

const hint: Partial<Record<ArgType, string>> = {
  when: `${WHEN.join(", ")} or YYYY-MM-DD`,
  day: "today, tomorrow, none or YYYY-MM-DD",
};

/** Parses `[positional…] [--name value]… [--flag]` against a command's argument spec. */
export function parseArgs(cmd: CommandDef, argv: string[]): Args {
  const out: Args = {};
  const entries = Object.entries(cmd.args);
  const positional = entries.find(([, s]) => s.positional);
  const put = (name: string, spec: ArgSpec, value: string) => {
    if (spec.values && !spec.values.includes(value))
      throw new Error(`--${name} is one of ${spec.values.join(", ")}`);
    if (valid[spec.type] && !valid[spec.type]!(value))
      throw new Error(`--${name} takes ${hint[spec.type] ?? "a number"}, not "${value}"`);
    if (spec.type === "number") out[name] = Number(value);
    else if (spec.type === "list")
      out[name] = [...((out[name] as string[]) ?? []), ...value.split(",").map((s) => s.trim())];
    else if (spec.type === "strings" || spec.type === "refs")
      out[name] = [...((out[name] as string[]) ?? []), value];
    else out[name] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (!word.startsWith("--")) {
      if (!positional || (positional[1].type !== "refs" && positional[0] in out))
        throw new Error(`Unexpected "${word}"`);
      put(positional[0], positional[1], word);
      continue;
    }
    const [name, inline] = word.slice(2).split(/=(.*)/s) as [string, string | undefined];
    const spec = cmd.args[name];
    if (!spec) throw new Error(`Unknown option --${name} for ${cmd.name}`);
    if (spec.type === "boolean") out[name] = inline === undefined ? true : inline !== "false";
    else {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new Error(`--${name} needs a value`);
      put(name, spec, value);
    }
  }
  for (const [name, spec] of entries)
    if (spec.required && !(name in out)) throw new Error(`${name} is required`);
  return out;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const worldAt = (ctx: Ctx) => {
  const w = world(ctx.docs.values());
  w.keepDoneSince = toDate(ctx.today).getTime();
  return w;
};

/** Finds an item by id, id prefix (6+ characters) or exact title, ignoring case. */
export function resolve(w: World, ref: string, types?: readonly Type[]): Item {
  const fits = (i: Item) => !types || types.includes(i.type);
  const exact = w.byId.get(ref);
  if (exact && fits(exact)) return exact;
  const candidates = [...w.byId.values()].filter(fits);
  const lower = ref.toLowerCase();
  let hits = lower.length >= 6 ? candidates.filter((i) => i.id.startsWith(lower)) : [];
  if (!hits.length) hits = candidates.filter((i) => "title" in i && fold(i.title) === fold(ref));
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches ${hits.length} items: ${hits.map((i) => `${i.id} (${"title" in i ? i.title : i.type})`).join(", ")}`,
    );
  throw new Error(types?.length === 1 ? `No ${types[0]} "${ref}"` : `Nothing matches "${ref}"`);
}

const TASK = ["todo", "project"] as const;
const refsOf = (w: World, refs: unknown, types: readonly Type[] = TASK) =>
  ((refs as string[]) ?? []).map((r) => resolve(w, r, types).id);

/** Runs ops one after another, each seeing the previous ones' changes; returns every changed document. */
export function seq(ctx: Ctx, ops: Op[]): Doc[] {
  const docs = new Map(ctx.docs);
  const out = new Map<Id, Doc>();
  for (const op of ops)
    for (const d of op({ ...ctx, docs })) {
      docs.set(d.id, d);
      out.set(d.id, d);
    }
  return [...out.values()];
}

const dayValue = (v: string, today: string) =>
  v === "none" ? null : v === "today" ? today : v === "tomorrow" ? addDays(today, 1) : v;

const whenWhere = (when: string, today: string): Where =>
  isDay(when) || when === "tomorrow"
    ? `day:${dayValue(when, today)}`
    : when === "evening"
      ? "evening"
      : (when as Where);

/** Where a container argument puts an item: a heading, project or area. */
function containerWhere(w: World, args: Args): Where | undefined {
  if (args.heading) {
    const project = args.project ? resolve(w, args.project as string, ["project"]).id : undefined;
    const headings = w.headings.filter((h) => !project || h.project === project);
    return `heading:${resolve(worldOfItems(w, headings), args.heading as string, ["heading"]).id}`;
  }
  if (args.project) return `project:${resolve(w, args.project as string, ["project"]).id}`;
  if (args.area) return `area:${resolve(w, args.area as string, ["area"]).id}`;
}

const worldOfItems = (w: World, items: Item[]): World => ({
  ...w,
  byId: new Map(items.map((i) => [i.id, i])),
});

const ref = (w: World, id: Id | null | undefined) => {
  const item = id ? w.byId.get(id) : undefined;
  return item && "title" in item ? { id: item.id, title: item.title } : null;
};

export function summary(w: World, item: Item) {
  if (item.type !== "todo" && item.type !== "project") return item;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    start: item.start,
    when: item.when,
    evening: item.evening,
    deadline: item.deadline,
    tags: item.tags.flatMap((id) => ref(w, id)?.title ?? []),
    project: item.type === "todo" ? ref(w, item.project) : null,
    heading: item.type === "todo" ? ref(w, item.heading) : null,
    area: ref(w, item.area),
  };
}

function details(w: World, item: Item) {
  if (item.type !== "todo" && item.type !== "project") return item;
  return {
    ...summary(w, item),
    notes: item.notes,
    created: item.created,
    stopped: item.stopped,
    trashed: item.trashed,
    ...(item.type === "todo" && {
      reminder: item.reminder,
      repeat: item.repeat,
      checklist: checklistOf(w, item.id).map((c) => ({ id: c.id, title: c.title, done: c.done })),
    }),
  };
}

const sections = (w: World, s: Section[]) =>
  s.map((x) => ({
    key: x.key,
    ...(x.title && { title: x.title }),
    items: x.items.map((t) => summary(w, t)),
  }));

const refs: ArgSpec = {
  type: "refs",
  summary: "ids, id prefixes or titles",
  positional: true,
  required: true,
};
const fields: Record<string, ArgSpec> = {
  notes: { type: "string", summary: "notes (Markdown)" },
  when: { type: "when", summary: `${WHEN.join(", ")} or YYYY-MM-DD` },
  deadline: { type: "day", summary: "YYYY-MM-DD, today, tomorrow; none clears it" },
  tags: { type: "list", summary: "tag titles, comma-separated" },
  project: { type: "ref", summary: "project id or title" },
  heading: { type: "ref", summary: "heading id or title (within --project if given)" },
  area: { type: "ref", summary: "area id or title" },
};

const patchOf = (w: World, args: Args, today: string) => {
  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.notes !== undefined) patch.notes = args.notes;
  if (args.deadline !== undefined) patch.deadline = dayValue(args.deadline as string, today);
  if (args.tags !== undefined) patch.tags = refsOf(w, args.tags, ["tag"]);
  return patch;
};

const status = (target: "completed" | "canceled", verb: string): CommandDef => ({
  name: verb,
  summary: `Marks to-dos or projects ${target}`,
  write: true,
  args: { refs, toggle: { type: "boolean", summary: "reopen the ones already " + target } },
  run(ctx, args) {
    const w = worldAt(ctx);
    const ids = refsOf(w, args.refs).filter(
      (id) => args.toggle || (w.byId.get(id) as { status: string }).status !== target,
    );
    const docs = setStatus(ids, target)(ctx);
    return { docs, result: changed(ctx, docs) };
  },
});

const changed = (ctx: Ctx, docs: Doc[]) => {
  const all = new Map(ctx.docs);
  for (const d of docs) all.set(d.id, d);
  const w = worldAt({ ...ctx, docs: all });
  return docs.flatMap((d) => {
    const item = w.byId.get(d.id);
    return [item ? (summary(w, item) as object) : { id: d.id, deleted: true }];
  });
};

export const commands: CommandDef[] = [
  {
    name: "list",
    summary: "Lists the items in a list, project, area or tag, by section",
    write: false,
    args: {
      list: {
        type: "enum",
        summary: "which list",
        positional: true,
        values: [...LISTS, "projects", "areas", "tags"],
      },
      project: { type: "ref", summary: "a project's to-dos" },
      area: { type: "ref", summary: "an area's projects and to-dos" },
      tag: { type: "ref", summary: "only items with this tag (or a child tag)" },
      query: { type: "string", summary: "only items whose title or notes contain this" },
    },
    run(ctx, args) {
      const w = worldAt(ctx);
      const name = args.list as string | undefined;
      if (name === "projects" || name === "areas" || name === "tags") {
        const items = (w[name] as Item[]).filter((i) => !("trashed" in i && i.trashed));
        const open = items.filter((i) => !("status" in i) || i.status === "open");
        return { result: { list: name, items: open.map((i) => summary(w, i)) } };
      }
      const id: ListId = args.project
        ? `project:${resolve(w, args.project as string, ["project"]).id}`
        : args.area
          ? `area:${resolve(w, args.area as string, ["area"]).id}`
          : ((name ?? "today") as ListId);
      let s = list(w, id, ctx.today);
      if (args.tag) s = withTag(s, w, resolve(w, args.tag as string, ["tag"]).id);
      if (args.query) {
        const q = fold(args.query as string);
        s = s
          .map((x) => ({
            ...x,
            items: x.items.filter((t) => fold(`${t.title}\n${t.notes}`).includes(q)),
          }))
          .filter((x) => x.items.length);
      }
      return { result: { list: id, sections: sections(w, s) } };
    },
  },
  {
    name: "show",
    summary: "Shows one item with its notes, checklist, tags, project and area",
    write: false,
    args: {
      ref: { type: "ref", summary: "id, id prefix or title", positional: true, required: true },
    },
    run: (ctx, args) => {
      const w = worldAt(ctx);
      return { result: details(w, resolve(w, args.ref as string)) };
    },
  },
  {
    name: "search",
    summary: "Finds lists, areas, projects, tags and to-dos, like Quick Find",
    write: false,
    args: {
      query: { type: "string", summary: "text to find", positional: true, required: true },
      limit: { type: "number", summary: "at most this many (30)" },
    },
    run: (ctx, args) => ({
      result: search(worldAt(ctx), args.query as string, (args.limit as number) ?? 30),
    }),
  },
  {
    name: "add",
    summary: "Adds a to-do (or a project, area, heading or tag with --type)",
    write: true,
    args: {
      title: { type: "string", summary: "title", positional: true, required: true },
      type: { type: "enum", summary: "what to add (todo)", values: TYPES },
      ...fields,
      checklist: { type: "strings", summary: "a checklist item; repeat for more" },
    },
    run(ctx, args) {
      const w = worldAt(ctx);
      const type = (args.type as (typeof TYPES)[number]) ?? "todo";
      const base = { title: args.title, ...patchOf(w, args, ctx.today) };
      if (type === "area" || type === "tag") {
        const docs = add(type, { title: args.title })(ctx);
        return { docs, result: changed(ctx, docs)[0] };
      }
      if (type === "heading") {
        if (!args.project) throw new Error("A heading needs --project");
        const project = resolve(w, args.project as string, ["project"]).id;
        const docs = add("heading", { title: args.title, project })(ctx);
        return { docs, result: changed(ctx, docs)[0] };
      }
      const container = containerWhere(w, args);
      const when = args.when as string | undefined;
      const where: Record<string, unknown> = {
        ...(container ? { start: "anytime", ...placement(container, ctx.today, w) } : {}),
        ...(when ? placement(whenWhere(when, ctx.today), ctx.today, w) : {}),
      };
      const [doc] = add(type, { ...where, ...base }, container || when ? undefined : "inbox")(ctx);
      const checklist = ((args.checklist as string[]) ?? []).map((title): Op =>
        add("checklist", { title, todo: doc!.id }),
      );
      const docs = [
        doc!,
        ...seq({ ...ctx, docs: new Map([...ctx.docs, [doc!.id, doc!]]) }, checklist),
      ];
      return { docs, result: changed(ctx, docs)[0] };
    },
  },
  {
    name: "edit",
    summary: "Changes an item's title, notes, dates, tags or place",
    write: true,
    args: {
      ref: { type: "ref", summary: "id, id prefix or title", positional: true, required: true },
      title: { type: "string", summary: "new title" },
      ...fields,
    },
    run(ctx, args) {
      const w = worldAt(ctx);
      const id = resolve(w, args.ref as string).id;
      const ops: Op[] = [];
      const patch = patchOf(w, args, ctx.today);
      if (Object.keys(patch).length) ops.push(set([id], patch));
      const container = containerWhere(w, args);
      if (container) ops.push(moveTo([id], container));
      if (args.when) ops.push(moveTo([id], whenWhere(args.when as string, ctx.today)));
      const docs = seq(ctx, ops);
      return { docs, result: changed(ctx, docs) };
    },
  },
  status("completed", "complete"),
  status("canceled", "cancel"),
  {
    name: "reopen",
    summary: "Marks completed or canceled to-dos or projects open again",
    write: true,
    args: { refs },
    run(ctx, args) {
      const w = worldAt(ctx);
      const ids = refsOf(w, args.refs).filter(
        (id) => (w.byId.get(id) as { status: string }).status !== "open",
      );
      const docs = set(ids, { status: "open", stopped: null })(ctx);
      return { docs, result: changed(ctx, docs) };
    },
  },
  {
    name: "move",
    summary: "Moves items to a list, project, area or heading, like dropping them on the sidebar",
    write: true,
    args: {
      refs,
      to: {
        type: "string",
        summary: `${WHEN.join(", ")}, YYYY-MM-DD, or a project, area or heading`,
        required: true,
      },
    },
    run(ctx, args) {
      const w = worldAt(ctx);
      const to = args.to as string;
      const where: Where = valid.when!(to)
        ? whenWhere(to, ctx.today)
        : (() => {
            const target = resolve(w, to, ["project", "area", "heading"]);
            return `${target.type}:${target.id}` as Where;
          })();
      const docs = moveTo(refsOf(w, args.refs), where)(ctx);
      return { docs, result: changed(ctx, docs) };
    },
  },
  {
    name: "delete",
    summary: "Moves items to the Trash, or deletes them for good with --permanent",
    write: true,
    args: { refs, permanent: { type: "boolean", summary: "delete for good on every Mac" } },
    run(ctx, args) {
      const w = worldAt(ctx);
      const ids = refsOf(w, args.refs, ["todo", "project", "area", "heading", "tag", "checklist"]);
      const docs = (args.permanent ? destroy(ids) : trash(ids))(ctx);
      return { docs, result: changed(ctx, docs) };
    },
  },
];

export const commandNamed = (name: string) => {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`Unknown command "${name}"`);
  return cmd;
};

export function runCommand(ctx: Ctx, name: string, args: Args) {
  const { docs = [], result } = commandNamed(name).run(ctx, args);
  return { docs, result };
}

/** A write command as an `Op`, for shortcuts and context menus. */
export const commandOp =
  (name: string, args: Args): Op =>
  (ctx) =>
    runCommand(ctx, name, args).docs;
