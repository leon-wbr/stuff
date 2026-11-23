import { asText, convertToProject, reopen } from "@stuff/core/actions";
import { shortcutLabel, type Command } from "@stuff/core/keys";
import type { Task, World } from "@stuff/core/lists";
import type { View } from "@stuff/core/machine";
import type { Id } from "@stuff/core/model";
import { add, emptyTrash, moveTo, set, trash, type Where } from "@stuff/core/ops";
import { stopRepeating } from "@stuff/core/repeat";
import { thingsUrl } from "@stuff/core/thingsUrl";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@stuff/ui/components/context-menu";
import { addDays } from "@stuff/core/days";
import { useSyncExternalStore, type ReactNode } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { usePanel } from "./ui.tsx";
import { useCommands } from "./useShortcuts.ts";

/** What a right-click landed on. */
export type Target =
  | { kind: "tasks"; ids: Id[] }
  | { kind: "heading"; id: Id }
  | { kind: "view"; view: View };

const ITEM = "gap-2 rounded-md px-2 py-1 text-ui font-normal";

function Item(props: {
  children: ReactNode;
  onClick(): void;
  shortcut?: Command;
  destructive?: boolean;
}) {
  const keys = props.shortcut && shortcutLabel(props.shortcut);
  return (
    <ContextMenuItem
      className={ITEM}
      variant={props.destructive ? "destructive" : "default"}
      onClick={props.onClick}
    >
      {props.children}
      {keys && <ContextMenuShortcut className="pl-6 tracking-normal">{keys}</ContextMenuShortcut>}
    </ContextMenuItem>
  );
}

function Sub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={ITEM}>{label}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52 rounded-xl p-1">{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

const Separator = () => <ContextMenuSeparator className="-mx-1 my-1" />;

const copy = (text: string) => navigator.clipboard.writeText(text).catch(console.error);

const titleOf = (w: World, id: Id) => {
  const item = w.byId.get(id);
  return (item && "title" in item && item.title) || "";
};

/** Adds an empty to-do in `where`, shows that list and opens the new to-do. */
function useNewTodo() {
  const change = useChange();
  const { send } = Stuff.useActorRef();
  return (where: Where, view: View, fields: Record<string, unknown> = {}) =>
    change((ctx) => {
      const docs = add("todo", { title: "", ...fields }, where)(ctx);
      queueMicrotask(() => {
        send({ type: "view", view });
        send({ type: "edit", id: docs[0]!.id });
      });
      return docs;
    });
}

function WhenItems({ ids }: { ids: Id[] }) {
  const perform = useCommands();
  const change = useChange();
  const today = Stuff.useSelector((s) => s.context.today);
  const run = (c: Command) => () => perform(c, ids);
  return (
    <Sub label="When">
      <Item onClick={run("today")} shortcut="today">
        Today
      </Item>
      <Item onClick={run("evening")} shortcut="evening">
        This Evening
      </Item>
      <Item onClick={() => change(moveTo(ids, `day:${addDays(today, 1)}`))}>Tomorrow</Item>
      <Item onClick={run("anytime")} shortcut="anytime">
        Anytime
      </Item>
      <Item onClick={run("someday")} shortcut="someday">
        Someday
      </Item>
      <Separator />
      <Item onClick={run("when")} shortcut="when">
        Choose Date…
      </Item>
    </Sub>
  );
}

function ShareItems({ ids }: { ids: Id[] }) {
  const w = useWorld();
  const perform = useCommands();
  const today = Stuff.useSelector((s) => s.context.today);
  return (
    <Sub label="Share">
      <Item onClick={() => copy(asText(w, ids))}>Copy as Text</Item>
      <Item onClick={() => copy(thingsUrl(w, ids, today))}>Copy Things Link</Item>
      <Item onClick={() => perform("sendToThings", ids)} shortcut="sendToThings">
        Send to Things
      </Item>
    </Sub>
  );
}

/** To-dos (one or a multi-selection) and project rows. */
export function TaskMenu({ ids }: { ids: Id[] }) {
  const w = useWorld();
  const view = Stuff.useSelector((s) => s.context.view);
  const perform = useCommands();
  const change = useChange();
  const { open } = usePanel();
  const items = ids.map((id) => w.byId.get(id)).filter((t): t is Task => !!t && "status" in t);
  if (!items.length) return null;
  if (items.length === 1 && items[0]!.type === "project") return <ProjectItems id={items[0]!.id} />;
  const run = (c: Command) => () => perform(c, ids);
  const todos = items.filter((t) => t.type === "todo");
  const single = items.length === 1 ? items[0] : undefined;
  if (todos.length && todos.every((t) => t.repeat)) {
    return (
      <>
        <Item onClick={run("repeat")} shortcut="repeat">
          Repeat…
        </Item>
        <Item onClick={() => ids.forEach((id) => change(stopRepeating(id)))}>Stop Repeating</Item>
        <Separator />
        <Item onClick={run("trash")} shortcut="trash" destructive>
          Delete
        </Item>
      </>
    );
  }
  const open_ = items.filter((t) => t.status === "open").map((t) => t.id);
  const finished = items.filter((t) => t.status !== "open").map((t) => t.id);
  if (view === "trash") return <Item onClick={() => change(trash(ids, false))}>Put Back</Item>;
  return (
    <>
      {open_.length > 0 && (
        <>
          <Item onClick={() => perform("complete", open_)} shortcut="complete">
            Complete
          </Item>
          <Item onClick={() => perform("cancel", open_)} shortcut="cancel">
            Mark as Canceled
          </Item>
        </>
      )}
      {finished.length > 0 && <Item onClick={() => change(reopen(finished))}>Reopen</Item>}
      <Separator />
      <WhenItems ids={ids} />
      <Item onClick={run("deadline")} shortcut="deadline">
        Deadline…
      </Item>
      {todos.length === items.length && (
        <Item onClick={() => open({ kind: "reminder", ids })}>Reminder…</Item>
      )}
      <Item onClick={run("tags")} shortcut="tags">
        Tags…
      </Item>
      <Item onClick={run("move")} shortcut="move">
        Move…
      </Item>
      {single?.type === "todo" && (
        <Item onClick={run("repeat")} shortcut="repeat">
          Repeat…
        </Item>
      )}
      <Separator />
      {single && (
        <Item onClick={run("open")} shortcut="open">
          Get Info
        </Item>
      )}
      <Item onClick={run("duplicate")} shortcut="duplicate">
        Duplicate
      </Item>
      {single?.type === "todo" && !single.project && !single.template && (
        <Item onClick={() => change(convertToProject(single.id))}>Convert to Project</Item>
      )}
      <ShareItems ids={ids} />
      <Separator />
      <Item onClick={run("trash")} shortcut="trash" destructive>
        {items.length > 1 ? `Delete ${items.length} Items` : "Delete"}
      </Item>
    </>
  );
}

function ProjectItems({ id, onRename }: { id: Id; onRename?(): void }) {
  const w = useWorld();
  const view = Stuff.useSelector((s) => s.context.view);
  const { send } = Stuff.useActorRef();
  const perform = useCommands();
  const change = useChange();
  const newTodo = useNewTodo();
  const project = w.byId.get(id);
  if (project?.type !== "project") return null;
  const done = project.status !== "open";
  const go = (v: View) => send({ type: "view", view: v });
  return (
    <>
      {view !== `project:${id}` && <Item onClick={() => go(`project:${id}`)}>Open</Item>}
      <Item onClick={() => newTodo(`project:${id}`, `project:${id}`)}>New To-Do in Project</Item>
      <Item
        onClick={() => {
          change(add("heading", { title: "", project: id }));
          go(`project:${id}`);
        }}
      >
        New Heading
      </Item>
      {onRename && <Item onClick={onRename}>Rename</Item>}
      <Separator />
      {done ? (
        <Item onClick={() => change(reopen([id]))}>Reopen Project</Item>
      ) : (
        <>
          <Item onClick={() => perform("complete", [id])} shortcut="complete">
            Complete Project
          </Item>
          <Item onClick={() => perform("cancel", [id])} shortcut="cancel">
            Cancel Project
          </Item>
        </>
      )}
      <Separator />
      <WhenItems ids={[id]} />
      <Item onClick={() => perform("deadline", [id])} shortcut="deadline">
        Deadline…
      </Item>
      <Item onClick={() => perform("tags", [id])} shortcut="tags">
        Tags…
      </Item>
      <Item onClick={() => perform("move", [id])} shortcut="move">
        Move to Area…
      </Item>
      <ShareItems ids={[id]} />
      <Separator />
      <Item
        destructive
        onClick={() => {
          change(trash([id]));
          if (view === `project:${id}`) go("today");
        }}
      >
        Delete Project
      </Item>
    </>
  );
}

function AreaItems({ id, onRename }: { id: Id; onRename?(): void }) {
  const view = Stuff.useSelector((s) => s.context.view);
  const { send } = Stuff.useActorRef();
  const change = useChange();
  const newTodo = useNewTodo();
  const { collapsed, toggle } = useCollapsedAreas();
  return (
    <>
      <Item onClick={() => newTodo(`area:${id}`, `area:${id}`)}>New To-Do in Area</Item>
      <Item
        onClick={() =>
          change((ctx) => {
            const docs = add("project", { title: "" }, `area:${id}`)(ctx);
            queueMicrotask(() => send({ type: "view", view: `project:${docs[0]!.id}` }));
            return docs;
          })
        }
      >
        New Project in Area
      </Item>
      <Separator />
      {onRename && <Item onClick={onRename}>Rename</Item>}
      <Item onClick={() => toggle(id)}>{collapsed.has(id) ? "Expand" : "Collapse"}</Item>
      <Separator />
      <Item
        destructive
        onClick={() => {
          change(trash([id]));
          if (view === `area:${id}`) send({ type: "view", view: "today" });
        }}
      >
        Delete Area
      </Item>
    </>
  );
}

function HeadingItems({ id }: { id: Id }) {
  const change = useChange();
  const view = Stuff.useSelector((s) => s.context.view);
  const newTodo = useNewTodo();
  return (
    <>
      <Item onClick={() => newTodo(`heading:${id}`, view)}>New To-Do Under Heading</Item>
      <Item
        onClick={() =>
          requestAnimationFrame(() =>
            document.querySelector<HTMLInputElement>(`[data-heading="${id}"] input`)?.select(),
          )
        }
      >
        Rename
      </Item>
      <Item onClick={() => change(set([id], { archived: true }))}>Archive Heading</Item>
      <Separator />
      <Item destructive onClick={() => change(trash([id]))}>
        Delete Heading
      </Item>
    </>
  );
}

const NEW_IN: Partial<Record<View, Where>> = {
  inbox: "inbox",
  today: "today",
  anytime: "anytime",
  someday: "someday",
};

/** Built-in lists, areas, projects and tags in the sidebar, and empty space in a list. */
function ViewItems({ view, onRename }: { view: View; onRename?(): void }) {
  const w = useWorld();
  const change = useChange();
  const perform = useCommands();
  const newTodo = useNewTodo();
  const [kind, id = ""] = view.split(":");
  if (kind === "project") return <ProjectItems id={id} onRename={onRename} />;
  if (kind === "area") return <AreaItems id={id} onRename={onRename} />;
  if (kind === "tag")
    return (
      <>
        {onRename && <Item onClick={onRename}>Rename</Item>}
        <Item onClick={() => newTodo("anytime", view, { tags: [id] })}>
          New To-Do Tagged “{titleOf(w, id)}”
        </Item>
      </>
    );
  const where = NEW_IN[view];
  if (where)
    return (
      <Item onClick={() => newTodo(where, view)} shortcut="newTodo">
        New To-Do
      </Item>
    );
  if (view === "trash")
    return (
      <Item destructive onClick={() => change(emptyTrash)}>
        Empty Trash
      </Item>
    );
  return (
    <Item onClick={() => perform("find")} shortcut="find">
      Quick Find
    </Item>
  );
}

/** The menu for whatever was right-clicked. */
export function TargetMenu({
  target,
  onRename,
}: {
  target: Target | null;
  onRename?(id: Id): void;
}) {
  const content =
    target?.kind === "tasks" ? (
      <TaskMenu ids={target.ids} />
    ) : target?.kind === "heading" ? (
      <HeadingItems id={target.id} />
    ) : target?.kind === "view" ? (
      <ViewItems
        view={target.view}
        onRename={
          onRename && target.view.includes(":")
            ? () => onRename(target.view.split(":")[1]!)
            : undefined
        }
      />
    ) : null;
  return (
    <ContextMenuContent className="min-w-56 rounded-xl p-1 text-ui">{content}</ContextMenuContent>
  );
}

const COLLAPSED_KEY = "collapsed-areas";
const listeners = new Set<() => void>();
let collapsedAreas = new Set<Id>(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as Id[]);

/** Which sidebar areas are collapsed, kept per Mac in localStorage. */
export function useCollapsedAreas() {
  const collapsed = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => collapsedAreas,
  );
  const toggle = (id: Id) => {
    collapsedAreas = new Set(collapsedAreas);
    if (!collapsedAreas.delete(id)) collapsedAreas.add(id);
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedAreas]));
    for (const fn of listeners) fn();
  };
  return { collapsed, toggle };
}
