import { duplicate } from "@stuff/core/actions";
import { commandFor, startsTypeTravel, type Command } from "@stuff/core/keys";
import { commandOp } from "@stuff/core/commands";
import type { Id } from "@stuff/core/model";
import { add, dropAt, reorder, type Where } from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { sectionsFor, whereFor } from "./ListView.tsx";
import { usePanel } from "./ui.tsx";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Runs a command on `target` (default: the selection), the same way for keys and menus. */
export function useCommands() {
  const w = useWorld();
  const change = useChange();
  const actor = Stuff.useActorRef();
  const { open, toggleSidebar } = usePanel();
  const state = useRef(w);
  state.current = w;

  return useCallback(
    (command: Command, target?: Id[]) => {
      const w = state.current;
      const { view, today, selection, editing } = actor.getSnapshot().context;
      const sections = sectionsFor(w, view, today);
      const order = sections.flatMap((s) => s.items.map((t) => t.id));
      const ids = (target ?? selection).filter((id) => w.byId.has(id));
      const sectionOf = (id?: string) => sections.find((s) => s.items.some((t) => t.id === id));
      const newTodo = (after?: string) =>
        change((ctx) => {
          const docs = add(
            "todo",
            { title: "" },
            whereFor(view, sectionOf(after) ?? sections[0], today, w),
            after,
          )(ctx);
          queueMicrotask(() => actor.send({ type: "edit", id: docs[0]!.id }));
          return docs;
        });
      const step = (dir: 1 | -1, extend: boolean) => {
        const last = ids.at(-1);
        const at = last ? order.indexOf(last) + dir : dir === 1 ? 0 : order.length - 1;
        const next = order[Math.max(0, Math.min(order.length - 1, at))];
        if (next)
          actor.send({ type: "select", ids: extend ? [...new Set([...ids, next])] : [next] });
      };
      const move = (dir: 1 | -1) => {
        const section = sectionOf(ids[0]);
        if (!section) return;
        const sectionOrder = section.items.map((t) => t.id);
        const at = sectionOrder.indexOf(ids[0]!);
        const to =
          dir === -1 ? Math.max(0, at - 1) : Math.min(sectionOrder.length, at + ids.length + 1);
        const { before, after } = dropAt(sectionOrder, ids, to);
        change(reorder(ids, before, after, view === "today" ? "todayIndex" : "index"));
      };
      const any = ids.length > 0;
      const handlers: Partial<Record<Command, () => void>> = {
        newTodo: () => newTodo(ids.at(-1)),
        newTodoBelow: () => newTodo(ids.at(-1)),
        newProject: () =>
          change((ctx) => {
            const docs = add(
              "project",
              { title: "" },
              view.startsWith("area:") ? (view as Where) : "anytime",
            )(ctx);
            queueMicrotask(() => actor.send({ type: "view", view: `project:${docs[0]!.id}` }));
            return docs;
          }),
        newHeading: () =>
          view.startsWith("project:") &&
          change(add("heading", { title: "", project: view.slice(8) })),
        newWindow: () => void invoke("new_window"),
        complete: () => any && change(commandOp("complete", { refs: ids, toggle: true })),
        cancel: () => any && change(commandOp("cancel", { refs: ids, toggle: true })),
        today: () => any && change(commandOp("move", { refs: ids, to: "today" })),
        evening: () => any && change(commandOp("move", { refs: ids, to: "evening" })),
        anytime: () => any && change(commandOp("move", { refs: ids, to: "anytime" })),
        someday: () => any && change(commandOp("move", { refs: ids, to: "someday" })),
        when: () => any && open({ kind: "when", ids }),
        deadline: () => any && open({ kind: "deadline", ids }),
        move: () => any && open({ kind: "move", ids }),
        tags: () => any && open({ kind: "tags", ids }),
        repeat: () =>
          ids.length === 1 && w.byId.get(ids[0]!)?.type === "todo" && open({ kind: "repeat", ids }),
        checklist: () => ids[0] && actor.send({ type: "edit", id: ids[0] }),
        duplicate: () => any && change(duplicate(ids)),
        trash: () => any && view !== "trash" && change(commandOp("delete", { refs: ids })),
        open: () => ids[0] && actor.send({ type: "edit", id: ids[0] }),
        close: () =>
          editing
            ? actor.send({ type: "edit", id: null })
            : actor.send({ type: "select", ids: [] }),
        up: () => step(-1, false),
        down: () => step(1, false),
        extendUp: () => step(-1, true),
        extendDown: () => step(1, true),
        moveUp: () => move(-1),
        moveDown: () => move(1),
        find: () => open({ kind: "find", query: "" }),
        undo: () => actor.send({ type: "undo" }),
        redo: () => actor.send({ type: "redo" }),
        toggleSidebar,
      };
      const handler = command.startsWith("go:")
        ? () => {
            const list = BUILT_IN[Number(command.slice(3)) - 1];
            if (list) actor.send({ type: "view", view: list.id });
          }
        : handlers[command];
      handler?.();
      return !!handler;
    },
    [actor, change, open, toggleSidebar],
  );
}

/** Things' keyboard shortcuts for the main window. */
export function useShortcuts() {
  const perform = useCommands();
  const { panel, open } = usePanel();
  const state = useRef(panel);
  state.current = panel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = commandFor(e);
      if (state.current || (typing(e.target) && command !== "complete" && !e.metaKey)) return;
      if (!command) {
        if (startsTypeTravel(e) && !typing(e.target)) {
          e.preventDefault();
          open({ kind: "find", query: e.key });
        }
        return;
      }
      if (
        typing(e.target) &&
        ["newTodoBelow", "trash", "up", "down", "open", "undo", "redo"].includes(command)
      )
        return;
      const pressing = e.target instanceof HTMLElement && e.target.closest("button, a");
      if (pressing && (command === "open" || command === "newTodoBelow")) return;
      if (perform(command)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [perform, open]);
}
