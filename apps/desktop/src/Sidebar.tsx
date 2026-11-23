import { CubeIcon, GearSixIcon, PlusIcon, TagIcon } from "@phosphor-icons/react";
import { inToday, list, progress, type World } from "@stuff/core/lists";
import type { View } from "@stuff/core/machine";
import type { Id } from "@stuff/core/model";
import { add, moveTo, setStatus, trash, type Op, type Where } from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { Popover, PopoverContent, PopoverTrigger } from "@stuff/ui/components/popover";
import { useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld, windowLabel } from "./app.ts";
import { ProgressRing, ViewIcon } from "./icons.tsx";
import { DRAG_TYPE } from "./ListView.tsx";
import { usePanel } from "./ui.tsx";
import { useSyncStatus } from "./sync.ts";

function Item({
  view,
  icon,
  label,
  count,
  drop,
  indent,
}: {
  view: View;
  icon: ReactNode;
  label: string;
  count?: number;
  drop?: (ids: Id[]) => Op;
  indent?: boolean;
}) {
  const current = Stuff.useSelector((s) => s.context.view);
  const { send } = Stuff.useActorRef();
  const change = useChange();
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      data-kind={view.split(":")[0]}
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
    <aside className="flex min-h-0 flex-col border-r bg-sidebar text-[13px]">
      <div data-tauri-drag-region className="h-12 shrink-0" />
      <nav aria-label="Lists" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
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
              />
              {projects(a.id)}
            </div>
          ))}
        {topTags.length > 0 && (
          <div className="mt-4">
            <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">Tags</p>
            {w.tags.map((t) => (
              <Item
                key={t.id}
                view={`tag:${t.id}`}
                icon={<TagIcon className="size-3.5 text-muted-foreground" />}
                label={t.title}
                indent={!!t.parent}
              />
            ))}
          </div>
        )}
      </nav>
      <div className="flex shrink-0 items-center gap-1 border-t px-2.5 py-2">
        <Popover>
          <PopoverTrigger className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-sidebar-accent">
            <PlusIcon className="size-4" />
            New List
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-48 gap-0 rounded-xl p-1 text-[13px]"
          >
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
