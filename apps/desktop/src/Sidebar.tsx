import {
  CaretDownIcon,
  CaretRightIcon,
  CubeIcon,
  GearSixIcon,
  PlusIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { inToday, list, progress, type World } from "@stuff/core/lists";
import type { View } from "@stuff/core/machine";
import type { Id } from "@stuff/core/model";
import { add, moveTo, set, setStatus, trash, type Op, type Where } from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { ContextMenu, ContextMenuTrigger } from "@stuff/ui/components/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@stuff/ui/components/popover";
import { useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld, windowLabel } from "./app.ts";
import { ProgressRing, ViewIcon } from "./icons.tsx";
import { DRAG_TYPE } from "./ListView.tsx";
import { TargetMenu, useCollapsedAreas, type Target } from "./menus.tsx";
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

export function Sidebar() {
  const w: World = useWorld();
  const today = Stuff.useSelector((s) => s.context.today);
  const change = useChange();
  const { send } = Stuff.useActorRef();
  const { open } = usePanel();
  const sync = useSyncStatus();
  const [target, setTarget] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const { collapsed, toggle } = useCollapsedAreas();
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
    w.projects
      .filter((p) => p.area === area && p.status === "open" && !p.trashed)
      .map((p) => (
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
  const topTags = w.tags.filter((t) => !t.parent);
  return (
    <aside className="flex min-h-0 flex-col border-r bg-sidebar text-ui">
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
                    <button
                      type="button"
                      aria-expanded={!collapsed.has(a.id)}
                      aria-label={`${collapsed.has(a.id) ? "Expand" : "Collapse"} ${a.title || "New Area"}`}
                      onClick={() => toggle(a.id)}
                      className={`absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent focus-visible:opacity-100 ${collapsed.has(a.id) ? "" : "opacity-0 group-hover/item:opacity-100"}`}
                    >
                      {collapsed.has(a.id) ? (
                        <CaretRightIcon className="size-3" />
                      ) : (
                        <CaretDownIcon className="size-3" />
                      )}
                    </button>
                  }
                />
                {!collapsed.has(a.id) && projects(a.id)}
              </div>
            ))}
          {topTags.length > 0 && (
            <div className="mt-4">
              <p className="px-2 pb-1 text-meta font-medium text-muted-foreground">Tags</p>
              {w.tags.map((t) => (
                <Item
                  key={t.id}
                  view={`tag:${t.id}`}
                  icon={<TagIcon className="size-3.5 text-muted-foreground" />}
                  label={t.title}
                  indent={!!t.parent}
                  renaming={renaming === t.id}
                  onRenamed={rename(t.id)}
                />
              ))}
            </div>
          )}
        </ContextMenuTrigger>
        <TargetMenu target={target} onRename={setRenaming} />
      </ContextMenu>
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
