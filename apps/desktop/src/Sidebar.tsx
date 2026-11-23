import {
  CaretDownIcon,
  CaretRightIcon,
  CubeIcon,
  GearSixIcon,
  PlusIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { areaProjects, childTags, inToday, list, progress, type World } from "@stuff/core/lists";
import type { View } from "@stuff/core/machine";
import type { Id } from "@stuff/core/model";
import { add, moveTo, set, setStatus, trash, type Op, type Where } from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { ContextMenu, ContextMenuTrigger } from "@stuff/ui/components/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@stuff/ui/components/popover";
import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld, windowLabel } from "./app.ts";
import { ProgressRing, ViewIcon } from "./icons.tsx";
import { DRAG_TYPE } from "./ListView.tsx";
import { TargetMenu, useCollapsed, type Target } from "./menus.tsx";
import { usePanel } from "./ui.tsx";
import { useSyncStatus } from "./sync.ts";

function Item({
  view,
  icon,
  label,
  count,
  drop,
  indent,
  renaming,
  onRenamed,
  disclosure,
}: {
  view: View;
  icon: ReactNode;
  label: string;
  count?: number;
  drop?: (ids: Id[]) => Op;
  indent?: boolean;
  renaming?: boolean;
  onRenamed?(title: string | null): void;
  disclosure?: ReactNode;
}) {
  const current = Stuff.useSelector((s) => s.context.view);
  const { send } = Stuff.useActorRef();
  const change = useChange();
  const [over, setOver] = useState(false);
  if (renaming)
    return (
      <input
        autoFocus
        defaultValue={label}
        aria-label="Name"
        onFocus={(e) => e.target.select()}
        onBlur={(e) => onRenamed?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") onRenamed?.(null);
        }}
        className="w-full rounded-md bg-background px-2 py-[5px] ring-1 ring-primary outline-none"
      />
    );
  return (
    <div className="group/item relative">
      <button
        type="button"
        data-kind={view.split(":")[0]}
        data-view={view}
        aria-current={current === view ? "page" : undefined}
        onClick={() => {
          localStorage.setItem(`view:${windowLabel}`, view);
          send({ type: "view", view });
        }}
        onDragOver={(e) => {
          if (!drop || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]") as Id[];
          if (drop && ids.length) change(drop(ids));
        }}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left ${indent ? "pl-4" : ""} ${
          over
            ? "bg-primary/15 ring-1 ring-primary"
            : current === view
              ? "bg-sidebar-accent"
              : "hover:bg-sidebar-accent/60"
        }`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {!!count && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
      </button>
      {disclosure}
    </div>
  );
}

const to = (where: Where) => (ids: Id[]) => moveTo(ids, where);

const Caret = ({ open }: { open: boolean }) =>
  open ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />;

/** The chevron that collapses what's nested under an area or a parent tag. */
function Disclosure({ id, label }: { id: Id; label: string }) {
  const { collapsed, toggle } = useCollapsed();
  const open = !collapsed.has(id);
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      onClick={() => toggle(id)}
      className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent focus-visible:opacity-100 ${open ? "opacity-0 group-hover/item:opacity-100" : ""}`}
    >
      <Caret open={open} />
    </button>
  );
}

const TAGS = "tags";
const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const WIDTH_KEY = `sidebar-width:${windowLabel}`;
const clampWidth = (px: number) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
const themeWidth = () =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width"));

/** Drag, arrow keys or double-click (back to the theme's width) on the sidebar's right edge. */
function ResizeHandle() {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || null);
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (width) {
      root.setProperty("--sidebar-user-width", `${width}px`);
      localStorage.setItem(WIDTH_KEY, String(width));
    } else {
      root.removeProperty("--sidebar-user-width");
      localStorage.removeItem(WIDTH_KEY);
    }
  }, [width]);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Sidebar"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width ?? themeWidth()}
      tabIndex={0}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const left = e.currentTarget.parentElement!.getBoundingClientRect().left;
        setWidth(clampWidth(e.clientX - left));
      }}
      onDoubleClick={() => setWidth(null)}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -8, ArrowRight: 8 }[e.key];
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        setWidth(clampWidth((width ?? themeWidth()) + step * (e.shiftKey ? 4 : 1)));
      }}
      className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none hover:bg-primary/20 focus-visible:bg-primary/40"
    />
  );
}

export function Sidebar() {
  const w: World = useWorld();
  const today = Stuff.useSelector((s) => s.context.today);
  const change = useChange();
  const { send } = Stuff.useActorRef();
  const { open } = usePanel();
  const sync = useSyncStatus();
  const [target, setTarget] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const { collapsed, toggle } = useCollapsed();
  const rename = (id: Id) => (title: string | null) => {
    setRenaming(null);
    if (title !== null && title !== (w.byId.get(id) as { title?: string } | undefined)?.title)
      change(set([id], { title }));
  };
  const counts: Partial<Record<View, number>> = {
    inbox: list(w, "inbox", today)[0]?.items.filter((t) => t.status === "open").length,
    today: [...w.todos, ...w.projects].filter((t) => t.status === "open" && inToday(w, t, today))
      .length,
  };
  const drops: Partial<Record<View, (ids: Id[]) => Op>> = {
    inbox: to("inbox"),
    today: to("today"),
    anytime: to("anytime"),
    someday: to("someday"),
    logbook: (ids) => setStatus(ids, "completed"),
    trash: (ids) => trash(ids),
  };
  const projects = (area: Id | null) =>
    areaProjects(w, area).map((p) => (
      <Item
        key={p.id}
        view={`project:${p.id}`}
        icon={<ProgressRing {...progress(w, p.id)} />}
        label={p.title || "New Project"}
        drop={to(`project:${p.id}`)}
        indent={!!area}
        renaming={renaming === p.id}
        onRenamed={rename(p.id)}
      />
    ));
  const create = (type: "project" | "area") =>
    change((ctx) => {
      const docs = add(type, { title: "" }, type === "project" ? "anytime" : undefined)(ctx);
      queueMicrotask(() => send({ type: "view", view: `${type}:${docs[0]!.id}` }));
      return docs;
    });
  const tags = (parent: Id | null): ReactNode =>
    childTags(w, parent).map((t) => {
      const nested = childTags(w, t.id).length > 0;
      return (
        <Fragment key={t.id}>
          <Item
            view={`tag:${t.id}`}
            icon={<TagIcon className="size-3.5 text-muted-foreground" />}
            label={t.title}
            indent={!!parent}
            renaming={renaming === t.id}
            onRenamed={rename(t.id)}
            disclosure={nested && <Disclosure id={t.id} label={t.title} />}
          />
          {nested && !collapsed.has(t.id) && tags(t.id)}
        </Fragment>
      );
    });
  const tagsOpen = !collapsed.has(TAGS);
  return (
    <aside className="relative flex min-h-0 flex-col border-r bg-sidebar text-ui">
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <ContextMenu>
        <ContextMenuTrigger
          render={<nav />}
          aria-label="Lists"
          className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4"
          onContextMenu={(e) => {
            const view = (e.target as HTMLElement).closest<HTMLElement>("[data-view]")?.dataset
              .view;
            if (!view) return e.preventBaseUIHandler();
            setTarget({ kind: "view", view: view as View });
          }}
        >
          {BUILT_IN.map((l, i) => (
            <div key={l.id} className={i === 1 || i === 5 ? "mt-3" : ""}>
              <Item
                view={l.id}
                icon={<ViewIcon view={l.id} className="size-4" />}
                label={l.title}
                count={counts[l.id]}
                drop={drops[l.id]}
              />
            </div>
          ))}
          <div className="mt-4 flex flex-col">{projects(null)}</div>
          {w.areas
            .filter((a) => !a.trashed)
            .map((a) => (
              <div key={a.id} className="mt-3">
                <Item
                  view={`area:${a.id}`}
                  icon={<CubeIcon className="size-4 text-muted-foreground" />}
                  label={a.title || "New Area"}
                  drop={to(`area:${a.id}`)}
                  renaming={renaming === a.id}
                  onRenamed={rename(a.id)}
                  disclosure={
                    areaProjects(w, a.id).length > 0 && (
                      <Disclosure id={a.id} label={a.title || "New Area"} />
                    )
                  }
                />
                {!collapsed.has(a.id) && projects(a.id)}
              </div>
            ))}
          {childTags(w, null).length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                aria-expanded={tagsOpen}
                onClick={() => toggle(TAGS)}
                className="group/tags flex w-full items-center gap-1 rounded-md px-2 pb-1 text-meta font-medium text-muted-foreground hover:text-foreground"
              >
                Tags
                <span className={tagsOpen ? "opacity-0 group-hover/tags:opacity-100" : ""}>
                  <Caret open={tagsOpen} />
                </span>
              </button>
              {tagsOpen && tags(null)}
            </div>
          )}
        </ContextMenuTrigger>
        <TargetMenu target={target} onRename={setRenaming} />
      </ContextMenu>
      <ResizeHandle />
      <div className="flex shrink-0 items-center gap-1 border-t px-2.5 py-2">
        <Popover>
          <PopoverTrigger className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent">
            <PlusIcon className="size-4" />
            New List
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-48 gap-0 rounded-xl p-1 text-ui">
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => create("project")}
            >
              New Project
            </button>
            <button
              type="button"
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => create("area")}
            >
              New Area
            </button>
          </PopoverContent>
        </Popover>
        <span
          title={sync.text}
          aria-label={`Sync: ${sync.text}`}
          className={`size-2 rounded-full ${sync.color}`}
        />
        <button
          type="button"
          aria-label="Settings"
          onClick={() => open({ kind: "settings" })}
          className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent"
        >
          <GearSixIcon className="size-4" />
        </button>
      </div>
    </aside>
  );
}
