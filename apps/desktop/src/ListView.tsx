import {
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  CalendarBlankIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  ShareIcon,
  SidebarSimpleIcon,
} from "@phosphor-icons/react";
import { shortcutLabel } from "@stuff/core/keys";
import { chain } from "@stuff/core/actions";
import { toDate } from "@stuff/core/days";
import { list, progress, withTag, type Section, type Task, type World } from "@stuff/core/lists";
import type { View } from "@stuff/core/machine";
import type { Day, Id } from "@stuff/core/model";
import {
  add,
  dropAt,
  emptyTrash,
  moveTo,
  reorder,
  set,
  setStatus,
  trash,
  type Op,
  type Where,
} from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { Button } from "@stuff/ui/components/button";
import { ContextMenu, ContextMenuTrigger } from "@stuff/ui/components/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@stuff/ui/components/popover";
import { useMemo, useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { Editor, Notes } from "./Editor.tsx";
import { dayLabel, monthLabel } from "./format.ts";
import { ProgressRing, ViewIcon } from "./icons.tsx";
import { TargetMenu, type Target } from "./menus.tsx";
import { Row } from "./Row.tsx";
import { sendToThings } from "./things.ts";
import { usePanel } from "./ui.tsx";

export const DRAG_TYPE = "application/x-stuff-ids";
export const NEW_TYPE = "application/x-stuff-new";

export function sectionsFor(w: World, view: View, today: Day): Section[] {
  if (view.startsWith("tag:")) {
    const tag = view.slice(4);
    const all = [...w.todos, ...w.projects].filter(
      (t) => t.status === "open" && !t.trashed && !(t.type === "todo" && t.repeat),
    );
    return withTag([{ key: "tag", items: all }], w, tag);
  }
  return list(w, view as Exclude<View, `tag:${string}`>, today);
}

/** Where a new item goes, or where a dropped item lands, in a section of this view. */
export function whereFor(view: View, section: Section | undefined, today: Day, w: World): Where {
  if (view === "logbook" || view === "trash" || view.startsWith("tag:")) return "inbox";
  if (view === "today") return section?.key === "evening" ? "evening" : "today";
  if (view === "upcoming")
    return /^\d{4}-\d{2}-\d{2}$/.test(section?.key ?? "") ? `day:${section!.key}` : "upcoming";
  if (view.startsWith("project:") && section?.ref) return `heading:${section.ref}`;
  if ((view === "anytime" || view === "someday") && section?.ref)
    return `${w.byId.get(section.ref)?.type === "area" ? "area" : "project"}:${section.ref}`;
  return view as Where;
}

export const viewTitle = (w: World, view: View) => {
  const builtIn = BUILT_IN.find((l) => l.id === view);
  if (builtIn) return builtIn.title;
  const item = w.byId.get(view.split(":")[1] ?? "");
  return item && "title" in item ? item.title : "";
};

function SectionHeader({ section, view, today }: { section: Section; view: View; today: Day }) {
  const change = useChange();
  if (view === "upcoming") {
    const isDay = section.key.length === 10;
    return (
      <div className="mt-6 mb-1 flex items-baseline gap-2 border-b pb-1">
        {isDay && (
          <span className="text-2xl font-semibold tabular-nums">
            {toDate(section.key).getDate()}
          </span>
        )}
        <span className="font-medium text-muted-foreground">
          {isDay ? dayLabel(section.key, today) : monthLabel(section.key)}
        </span>
      </div>
    );
  }
  if (section.key === "evening")
    return (
      <div className="mt-6 mb-1 flex items-center gap-1.5 border-b pb-1 font-medium text-evening">
        <MoonIcon weight="fill" className="size-4" />
        This Evening
      </div>
    );
  if (!section.title) return null;
  const heading = view.startsWith("project:") && section.ref;
  return (
    <div
      data-heading={heading || undefined}
      className="mt-6 mb-1 flex items-center gap-2 border-b pb-1"
    >
      {heading ? (
        <input
          defaultValue={section.title}
          aria-label="Heading"
          onBlur={(e) =>
            e.target.value !== section.title &&
            change(set([section.ref!], { title: e.target.value }))
          }
          className="flex-1 bg-transparent font-heading text-primary outline-none"
        />
      ) : (
        <span className="font-heading">{section.title}</span>
      )}
      {heading && (
        <Popover>
          <PopoverTrigger
            aria-label="Heading actions"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
          >
            <DotsThreeIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 gap-0 rounded-xl p-1 text-ui">
            <MenuItem onClick={() => change(set([section.ref!], { archived: true }))}>
              Archive heading
            </MenuItem>
            <MenuItem onClick={() => change(trash([section.ref!]))}>Delete heading</MenuItem>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
    >
      {children}
    </button>
  );
}

function Header({ view, w, today }: { view: View; w: World; today: Day }) {
  const change = useChange();
  const { send } = Stuff.useActorRef();
  const id = view.split(":")[1] ?? "";
  const item = w.byId.get(id);
  const editable =
    (view.startsWith("project:") || view.startsWith("area:")) && item && "title" in item;
  const project = item?.type === "project" ? item : undefined;
  return (
    <header className="px-10 pt-2 pb-2">
      <div className="flex items-center gap-3">
        {project ? (
          <ProgressRing {...progress(w, project.id)} status={project.status} className="size-6" />
        ) : (
          <ViewIcon view={view} className="size-6" />
        )}
        {editable ? (
          <input
            key={id}
            defaultValue={item.title}
            placeholder={project ? "New Project" : "New Area"}
            aria-label="List title"
            onBlur={(e) =>
              e.target.value !== item.title && change(set([id], { title: e.target.value }))
            }
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="min-w-0 flex-1 bg-transparent font-display text-title font-title outline-none placeholder:text-muted-foreground/50"
          />
        ) : (
          <h1 className="flex-1 font-display text-title font-title">{viewTitle(w, view)}</h1>
        )}
        {project && (
          <Popover>
            <PopoverTrigger
              aria-label="Project actions"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <DotsThreeIcon className="size-5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-52 gap-0 rounded-xl p-1 text-ui">
              <MenuItem onClick={() => change(setStatus([id], "completed"))}>
                {project.status === "completed" ? "Reopen project" : "Complete project"}
              </MenuItem>
              <MenuItem onClick={() => change(setStatus([id], "canceled"))}>
                {project.status === "canceled" ? "Reopen project" : "Cancel project"}
              </MenuItem>
              <MenuItem onClick={() => change(add("heading", { title: "", project: id }))}>
                Add heading
              </MenuItem>
              <MenuItem onClick={() => sendToThings(w, [id])}>Send to Things</MenuItem>
              <MenuItem
                onClick={() => {
                  change(trash([id]));
                  send({ type: "view", view: "today" });
                }}
              >
                Delete project
              </MenuItem>
            </PopoverContent>
          </Popover>
        )}
        {item?.type === "area" && (
          <Popover>
            <PopoverTrigger
              aria-label="Area actions"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <DotsThreeIcon className="size-5" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 gap-0 rounded-xl p-1 text-ui">
              <MenuItem
                onClick={() => change(add("project", { title: "", area: id }, `area:${id}`))}
              >
                New project here
              </MenuItem>
              <MenuItem
                onClick={() => {
                  change(trash([id]));
                  send({ type: "view", view: "today" });
                }}
              >
                Delete area
              </MenuItem>
            </PopoverContent>
          </Popover>
        )}
        {view === "trash" && [...w.todos, ...w.projects].some((t) => t.trashed) && (
          <Button size="sm" variant="secondary" onClick={() => change(emptyTrash)}>
            Empty Trash
          </Button>
        )}
      </div>
      {project && (
        <div className="mt-2 pl-9 text-muted-foreground">
          <Notes id={id} notes={project.notes} />
          {project.deadline && (
            <p className="mt-1 text-xs text-deadline">
              Deadline {dayLabel(project.deadline, today)}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

function Empty({ view }: { view: View }) {
  const text: Partial<Record<View, string>> = {
    inbox: "Nothing in the Inbox. New to-dos land here until you file them.",
    today: "Nothing for today. Enjoy the quiet.",
    upcoming: "Nothing scheduled.",
    anytime: "Nothing here yet.",
    someday: "No someday plans.",
    logbook: "Completed to-dos show up here.",
    trash: "The Trash is empty.",
  };
  return <p className="px-10 py-10 text-center text-muted-foreground">{text[view] ?? ""}</p>;
}

export function ListView() {
  const w = useWorld();
  const { send } = Stuff.useActorRef();
  const change = useChange();
  const { open, sidebar, toggleSidebar } = usePanel();
  const { view, today, selection, editing } = Stuff.useSelector((s) => s.context);
  const sections = useMemo(() => sectionsFor(w, view, today), [w, view, today]);
  const order = useMemo(() => sections.flatMap((s) => s.items.map((t) => t.id)), [sections]);
  const [drop, setDrop] = useState<{ section: string; at: number } | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const field = view === "today" ? "todayIndex" : "index";
  const context =
    view === "today"
      ? "today"
      : view === "upcoming"
        ? "upcoming"
        : view === "logbook"
          ? "logbook"
          : view.startsWith("project:")
            ? "project"
            : "list";

  const select = (id: Id, e: React.MouseEvent) => {
    if (editing === id) return;
    if ((e.button === 2 || e.ctrlKey) && selection.includes(id)) return;
    if (editing) send({ type: "edit", id: null });
    if (e.metaKey)
      send({
        type: "select",
        ids: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id],
      });
    else if (e.shiftKey && selection.length) {
      const [a, b] = [order.indexOf(selection[0]!), order.indexOf(id)].sort((x, y) => x - y);
      send({ type: "select", ids: order.slice(a, b! + 1) });
    } else send({ type: "select", ids: [id] });
  };

  const addHere = (section: Section | undefined, after?: Id) =>
    change((ctx) => {
      const where = whereFor(view, section, today, w);
      const tag = view.startsWith("tag:") ? { tags: [view.slice(4)] } : {};
      const docs = add("todo", { title: "", ...tag }, where, after)(ctx);
      queueMicrotask(() => send({ type: "edit", id: docs[0]!.id }));
      return docs;
    });

  const onDrop = (e: React.DragEvent, section: Section, at: number) => {
    e.preventDefault();
    setDrop(null);
    const sectionOrder = section.items.map((t) => t.id);
    if (e.dataTransfer.types.includes(NEW_TYPE)) return addHere(section, sectionOrder[at - 1]);
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]") as Id[];
    if (!ids.length || view === "logbook" || view === "trash") return;
    const ops: Op[] = [];
    if (!ids.every((id) => sectionOrder.includes(id)))
      ops.push(moveTo(ids, whereFor(view, section, today, w)));
    const { before, after } = dropAt(sectionOrder, ids, at);
    ops.push(reorder(ids, before, after, field));
    change(chain(...ops));
  };

  const dragOver = (e: React.DragEvent, section: string, at: number) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE) && !e.dataTransfer.types.includes(NEW_TYPE))
      return;
    e.preventDefault();
    if (drop?.section !== section || drop.at !== at) setDrop({ section, at });
  };

  const indicator = (section: string, at: number) =>
    drop?.section === section && drop.at === at ? (
      <div className="mx-2 h-0.5 rounded bg-primary" />
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-tauri-drag-region
        className={`flex h-10 shrink-0 items-center ${sidebar ? "pl-2" : "pl-20"}`}
      >
        <button
          type="button"
          aria-label={sidebar ? "Hide Sidebar" : "Show Sidebar"}
          aria-pressed={sidebar}
          title={`${sidebar ? "Hide" : "Show"} Sidebar (${shortcutLabel("toggleSidebar")})`}
          onClick={toggleSidebar}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SidebarSimpleIcon className="size-[18px]" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto pb-24"
        onMouseDown={(e) => e.target === e.currentTarget && send({ type: "select", ids: [] })}
      >
        <Header view={view} w={w} today={today} />
        {!order.length && !view.startsWith("project:") && <Empty view={view} />}
        <ContextMenu>
          <ContextMenuTrigger
            role="listbox"
            aria-multiselectable
            aria-label={viewTitle(w, view)}
            className="min-h-40 px-8"
            onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}
            onContextMenu={(e) => {
              const el = e.target as HTMLElement;
              if (el.closest("[data-id]:not([role=option])")) return e.preventBaseUIHandler();
              const row = el.closest<HTMLElement>("[role=option]")?.dataset.id;
              const heading = el.closest<HTMLElement>("[data-heading]")?.dataset.heading;
              if (row) {
                const ids = selection.includes(row) ? selection : [row];
                if (!selection.includes(row)) send({ type: "select", ids });
                setTarget({ kind: "tasks", ids });
              } else if (heading) setTarget({ kind: "heading", id: heading });
              else setTarget({ kind: "view", view });
            }}
          >
            {sections.map((section) => (
              <section
                key={section.key}
                onDragOver={(e) =>
                  e.target === e.currentTarget && dragOver(e, section.key, section.items.length)
                }
                onDrop={(e) =>
                  onDrop(e, section, drop?.section === section.key ? drop.at : section.items.length)
                }
                className="pb-1"
              >
                <SectionHeader section={section} view={view} today={today} />
                {section.items.map((task: Task, i) => (
                  <div
                    key={task.id}
                    onDragOver={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      dragOver(e, section.key, e.clientY < rect.top + rect.height / 2 ? i : i + 1);
                    }}
                    onDrop={(e) => onDrop(e, section, drop?.at ?? i)}
                  >
                    {indicator(section.key, i)}
                    {editing === task.id ? (
                      <Editor task={task} w={w} today={today} />
                    ) : (
                      <Row
                        task={task}
                        w={w}
                        today={today}
                        context={context}
                        selected={selection.includes(task.id)}
                        onSelect={(e) => select(task.id, e)}
                        onOpen={() =>
                          task.type === "project" && view !== `project:${task.id}`
                            ? send({ type: "view", view: `project:${task.id}` })
                            : send({ type: "edit", id: task.id })
                        }
                        onDragStart={(e) => {
                          const ids = selection.includes(task.id) ? selection : [task.id];
                          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      />
                    )}
                    {i === section.items.length - 1 && indicator(section.key, i + 1)}
                  </div>
                ))}
                {!section.items.length && indicator(section.key, 0)}
              </section>
            ))}
          </ContextMenuTrigger>
          <TargetMenu target={target} />
        </ContextMenu>
      </div>
      <Toolbar
        onAdd={() => {
          const sel = selection.at(-1);
          const section = sections.find((s) => s.items.some((t) => t.id === sel)) ?? sections[0];
          addHere(section, sel);
        }}
        canAdd={view !== "logbook"}
        selection={selection}
        view={view}
        onOpen={open}
        onRestore={() => change(trash(selection, false))}
        w={w}
      />
    </div>
  );
}

function Toolbar(props: {
  onAdd(): void;
  canAdd: boolean;
  selection: Id[];
  view: View;
  onOpen: ReturnType<typeof usePanel>["open"];
  onRestore(): void;
  w: World;
}) {
  const { selection, view, onOpen } = props;
  const icon =
    "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30";
  return (
    <div className="relative flex h-11 shrink-0 items-center justify-center gap-6 border-t bg-background/80 backdrop-blur">
      {props.canAdd && (
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(NEW_TYPE, "1");
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={props.onAdd}
          aria-label="New To-Do"
          title="New To-Do (drag to place it)"
          className="absolute -top-7 right-8 grid size-11 place-items-center rounded-full bg-primary text-primary-foreground shadow-fab transition-transform hover:scale-105 active:cursor-grabbing"
        >
          <PlusIcon weight="bold" className="size-5" />
        </button>
      )}
      <button
        type="button"
        className={icon}
        aria-label="When"
        title="When (⌘S)"
        disabled={!selection.length}
        onClick={() => onOpen({ kind: "when", ids: selection })}
      >
        <CalendarBlankIcon className="size-[18px]" />
      </button>
      <button
        type="button"
        className={icon}
        aria-label="Move"
        title="Move (⇧⌘M)"
        disabled={!selection.length}
        onClick={() => onOpen({ kind: "move", ids: selection })}
      >
        <ArrowRightIcon className="size-[18px]" />
      </button>
      {view === "trash" ? (
        <button
          type="button"
          className={icon}
          aria-label="Put Back"
          title="Put Back"
          disabled={!selection.length}
          onClick={props.onRestore}
        >
          <ArrowUUpLeftIcon className="size-[18px]" />
        </button>
      ) : (
        <button
          type="button"
          className={icon}
          aria-label="Send to Things"
          title="Send to Things (⇧⌘S)"
          disabled={!selection.length}
          onClick={() => sendToThings(props.w, selection)}
        >
          <ShareIcon className="size-[18px]" />
        </button>
      )}
      <button
        type="button"
        className={icon}
        aria-label="Quick Find"
        title="Quick Find (⌘F)"
        onClick={() => onOpen({ kind: "find", query: "" })}
      >
        <MagnifyingGlassIcon className="size-[18px]" />
      </button>
    </div>
  );
}
