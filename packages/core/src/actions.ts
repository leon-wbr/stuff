import { generateKeyBetween } from "fractional-indexing";
import { create, materialize, remove, update, type Doc } from "./doc";
import { checklistOf, world, type Task, type World } from "./lists";
import type { Id, Todo } from "./model";
import { add, type Op } from "./ops";

/** Runs ops in turn on a copy of the documents, as one edit (and one undo step). */
export const chain =
  (...ops: Op[]): Op =>
  (ctx) => {
    const docs = new Map(ctx.docs);
    const changed = new Map<Id, Doc>();
    for (const op of ops)
      for (const d of op({ ...ctx, docs })) {
        docs.set(d.id, d);
        changed.set(d.id, d);
      }
    return [...changed.values()];
  };

/** Copies items right after their originals, open again, with their checklists. */
export const duplicate =
  (ids: Id[]): Op =>
  (ctx) => {
    const w = world(ctx.docs.values());
    return ids.flatMap((id) => {
      const { id: _id, type, index: _index, ...fields } = w.byId.get(id) as Task;
      const [copy] = add(type, { ...fields, status: "open", stopped: null }, undefined, id)(ctx);
      const items = checklistOf(w, id).map((c) =>
        create(
          "checklist",
          ctx.id(),
          { title: c.title, done: c.done, todo: copy!.id, index: c.index },
          ctx.clock,
        ),
      );
      return [copy!, ...items];
    });
  };

export const reopen =
  (ids: Id[]): Op =>
  (ctx) =>
    ids.flatMap((id) => {
      const doc = ctx.docs.get(id);
      if (!doc || materialize<Task>(doc).status === "open") return [];
      return [update(doc, { status: "open", stopped: null }, ctx.clock)];
    });

/** Replaces a loose to-do by a project with the same fields; its checklist items become to-dos. */
export const convertToProject =
  (id: Id): Op =>
  (ctx) => {
    const doc = ctx.docs.get(id);
    if (!doc || doc.type !== "todo") return [];
    const todo = materialize<Todo>(doc);
    if (todo.project || todo.repeat || todo.template) return [];
    const w = world(ctx.docs.values());
    const projectId = ctx.id();
    const {
      type: _t,
      id: _i,
      project: _p,
      heading: _h,
      reminder: _r,
      repeat: _re,
      next: _n,
      template: _te,
      ...fields
    } = todo;
    const project = create(
      "project",
      projectId,
      {
        ...fields,
        start: todo.start === "inbox" ? "anytime" : todo.start,
        created: ctx.now,
      },
      ctx.clock,
    );
    let last: string | null = null;
    const todos: Doc[] = [];
    for (const c of checklistOf(w, id)) {
      last = generateKeyBetween(last, null);
      todos.push(
        create(
          "todo",
          ctx.id(),
          {
            title: c.title,
            start: "anytime",
            project: projectId,
            index: last,
            created: ctx.now,
            ...(c.done && { status: "completed", stopped: ctx.now }),
          },
          ctx.clock,
        ),
        remove(ctx.docs.get(c.id)!, ctx.clock),
      );
    }
    return [project, ...todos, remove(doc, ctx.clock)];
  };

/** Items as a Markdown task list, for the clipboard. */
export function asText(w: World, ids: Id[]) {
  const box = (done: boolean) => (done ? "[x]" : "[ ]");
  return ids
    .flatMap((id) => {
      const t = w.byId.get(id);
      if (t?.type !== "todo" && t?.type !== "project") return [];
      return [
        `- ${box(t.status === "completed")} ${t.title}`,
        ...(t.notes ? t.notes.split("\n").map((l) => `  ${l}`) : []),
        ...checklistOf(w, id).map((c) => `  - ${box(c.done)} ${c.title}`),
      ];
    })
    .join("\n");
}
