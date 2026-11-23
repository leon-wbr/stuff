import { MagnifyingGlassIcon, TagIcon, CubeIcon } from "@phosphor-icons/react";
import { list } from "@stuff/core/lists";
import type { Todo } from "@stuff/core/model";
import { search, type Hit } from "@stuff/core/search";
import { Dialog, DialogContent, DialogTitle } from "@stuff/ui/components/dialog";
import { useEffect, useMemo, useState } from "react";
import { Stuff, useWorld } from "./app.ts";
import { ProgressRing, ViewIcon } from "./icons.tsx";
import { usePanel } from "./ui.tsx";

/** Quick Find and Type Travel: jump to a list, area, project, tag or to-do by typing. */
export function QuickFind() {
  const { panel, open } = usePanel();
  const w = useWorld();
  const { send } = Stuff.useActorRef();
  const today = Stuff.useSelector((s) => s.context.today);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const isOpen = panel?.kind === "find";
  useEffect(() => {
    if (panel?.kind === "find") {
      setQuery(panel.query);
      setActive(0);
    }
  }, [panel]);
  const hits = useMemo(() => search(w, query, 12), [w, query]);

  const go = (hit: Hit) => {
    open(null);
    if (hit.kind === "list") return send({ type: "view", view: hit.id });
    if (hit.kind !== "todo") return send({ type: "view", view: `${hit.kind}:${hit.id}` });
    const todo = w.byId.get(hit.id) as Todo;
    const home = (["today", "inbox", "upcoming", "anytime", "someday", "logbook"] as const).find(
      (v) => list(w, v, today).some((s) => s.items.some((t) => t.id === hit.id)),
    );
    send({
      type: "view",
      view: todo.project
        ? `project:${todo.project}`
        : (home ?? (todo.area ? `area:${todo.area}` : "anytime")),
    });
    send({ type: "select", ids: [hit.id] });
  };

  const icon = (hit: Hit) =>
    hit.kind === "list" ? (
      <ViewIcon view={hit.id} className="size-4" />
    ) : hit.kind === "project" ? (
      <ProgressRing done={0} total={1} />
    ) : hit.kind === "area" ? (
      <CubeIcon className="size-4 text-muted-foreground" />
    ) : hit.kind === "tag" ? (
      <TagIcon className="size-4 text-muted-foreground" />
    ) : (
      <span
        className={`size-3.5 rounded-[4px] border-[1.5px] ${hit.done ? "border-primary bg-primary" : "border-muted-foreground/45"}`}
      />
    );

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && open(null)}>
      <DialogContent
        showCloseButton={false}
        className="top-[22%] max-w-md translate-y-0 gap-0 rounded-2xl p-0 sm:max-w-md"
      >
        <DialogTitle className="sr-only">Quick Find</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <MagnifyingGlassIcon className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            aria-label="Quick Find"
            placeholder="Quick Find"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
              else if (e.key === "Enter" && hits[active]) go(hits[active]);
              else return;
              e.preventDefault();
            }}
            className="flex-1 bg-transparent text-[15px] outline-none"
          />
        </div>
        {hits.length > 0 && (
          <ul
            role="listbox"
            aria-label="Results"
            className="max-h-80 overflow-y-auto p-1.5 text-[13px]"
          >
            {hits.map((hit, i) => (
              <li
                key={`${hit.kind}:${hit.id}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={`flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 ${i === active ? "bg-accent" : ""}`}
              >
                {icon(hit)}
                <span
                  className={`truncate ${hit.kind !== "list" && "done" in hit && hit.done ? "text-muted-foreground" : ""}`}
                >
                  {hit.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
