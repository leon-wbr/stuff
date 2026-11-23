import { commandFor, startsTypeTravel, type Command } from "@stuff/core/keys";
import type { Task } from "@stuff/core/lists";
import { commandOp } from "@stuff/core/commands";
import { add, dropAt, reorder, type Op, type Where } from "@stuff/core/ops";
import { BUILT_IN } from "@stuff/core/search";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { sectionsFor, whereFor } from "./ListView.tsx";
import { sendToThings } from "./things.ts";
import { usePanel } from "./ui.tsx";

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** Things' keyboard shortcuts for the main window. */
export function useShortcuts() {
  const w = useWorld();
  const change = useChange();
  const actor = Stuff.useActorRef();
  const { panel, open } = usePanel();
  const state = useRef({ w, panel });
  state.current = { w, panel };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { w, panel } = state.current;
      const { view, today, selection, editing } = actor.getSnapshot().context;
      const command = commandFor(e);
      if (panel || (typing(e.target) && command !== "complete" && !e.metaKey)) return;
      if (!command) {
        if (startsTypeTravel(e) && !typing(e.target)) {
          e.preventDefault();
          open({ kind: "find", query: e.key });
        }
        return;
      }
      if (typing(e.target) && ["newTodoBelow", "trash", "up", "down", "open"].includes(command))
        return;
      const sections = sectionsFor(w, view, today);
      const order = sections.flatMap((s) => s.items.map((t) => t.id));
      const ids = selection.filter((id) => w.byId.has(id));
      const sectionOf = (id?: string) => sections.find((s) => s.items.some((t) => t.id === id));
      const run = (op: Op) => change(op);
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
          view.startsWith("project:") && run(add("heading", { title: "", project: view.slice(8) })),
        newWindow: () => void invoke("new_window"),
        complete: () => ids.length && run(commandOp("complete", { refs: ids, toggle: true })),
        cancel: () => ids.length && run(commandOp("cancel", { refs: ids, toggle: true })),
        today: () => ids.length && run(commandOp("move", { refs: ids, to: "today" })),
        evening: () => ids.length && run(commandOp("move", { refs: ids, to: "evening" })),
        anytime: () => ids.length && run(commandOp("move", { refs: ids, to: "anytime" })),
        someday: () => ids.length && run(commandOp("move", { refs: ids, to: "someday" })),
        when: () => ids.length && open({ kind: "when", ids }),
        deadline: () => ids.length && open({ kind: "deadline", ids }),
        move: () => ids.length && open({ kind: "move", ids }),
        tags: () => ids.length && open({ kind: "tags", ids }),
        checklist: () => ids[0] && actor.send({ type: "edit", id: ids[0] }),
        duplicate: () =>
          ids.length &&
          change((ctx) =>
            ids.flatMap((id) => {
              const { id: _id, type, index: _index, ...fields } = w.byId.get(id) as Task;
              return add(type, fields, undefined, id)(ctx);
            }),
          ),
        trash: () => ids.length && view !== "trash" && run(commandOp("delete", { refs: ids })),
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
        sendToThings: () => ids.length && sendToThings(w, ids),
      };
      const move = (dir: 1 | -1) => {
        const section = sectionOf(ids[0]);
        if (!section) return;
        const sectionOrder = section.items.map((t) => t.id);
        const at = sectionOrder.indexOf(ids[0]!);
        const to =
          dir === -1 ? Math.max(0, at - 1) : Math.min(sectionOrder.length, at + ids.length + 1);
        const { before, after } = dropAt(sectionOrder, ids, to);
        run(reorder(ids, before, after, view === "today" ? "todayIndex" : "index"));
      };
      const handler = command.startsWith("go:")
        ? () => {
            const list = BUILT_IN[Number(command.slice(3)) - 1];
            if (list) actor.send({ type: "view", view: list.id });
          }
        : handlers[command];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actor, change, open]);
}
