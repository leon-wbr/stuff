import { assign, fromCallback, fromPromise, setup } from "xstate";
import { dayOf } from "./days";
import { equal, merge, parseDoc, type Doc } from "./doc";
import { hlc, type Clock } from "./hlc";
import type { ListId } from "./lists";
import type { Day, Id } from "./model";
import { randomId, type Ctx, type Op } from "./ops";
import { spawnDue } from "./repeat";

export interface Deps {
  keyStatus(): Promise<string | null>;
  saveKey(command: "generate_key" | "import_key", nsec?: string): Promise<string>;
  load(): Promise<unknown[]>;
  save(docs: Doc[], dirty: boolean): Promise<void>;
  /** Documents written by other windows or by sync. Returns an unsubscribe function. */
  listen(onDocs: (docs: unknown[]) => void): () => void;
  now?(): number;
}

export type View = ListId | `tag:${Id}`;

export interface Context {
  clock: Clock;
  docs: Map<Id, Doc>;
  today: Day;
  now: () => number;
  npub?: string;
  keyError?: string;
  error?: string;
  view: View;
  selection: Id[];
  editing: Id | null;
}

export type Event =
  | { type: "key.create" }
  | { type: "key.import"; nsec: string }
  | { type: "change"; op: Op }
  | { type: "remote"; docs: unknown[] }
  | { type: "view"; view: View }
  | { type: "select"; ids: Id[] }
  | { type: "edit"; id: Id | null }
  | { type: "tick" };

export const editCtx = (c: Pick<Context, "docs" | "clock" | "today" | "now">): Ctx => ({
  docs: c.docs,
  clock: c.clock,
  id: randomId,
  now: c.now(),
  today: c.today,
});

const applied = (docs: Map<Id, Doc>, changed: Doc[]) => {
  const next = new Map(docs);
  for (const d of changed) next.set(d.id, d);
  return next;
};

type KeyCommand = { command: "generate_key" | "import_key"; nsec?: string };

export function appMachine(deps: Deps, view: View = "today") {
  const now = () => deps.now?.() ?? Date.now();
  const today = () => dayOf(new Date(now()));
  const keySaved = { target: "ready", actions: "keySaved" } as const;
  const keyFailed = { target: "missing", actions: "keyFailed" } as const;

  return setup({
    types: { context: {} as Context, events: {} as Event },
    actors: {
      keyStatus: fromPromise(() => deps.keyStatus()),
      saveKey: fromPromise(({ input }: { input: KeyCommand }) =>
        deps.saveKey(input.command, input.nsec),
      ),
      load: fromPromise(() => deps.load()),
      listen: fromCallback<Event>(({ sendBack }) =>
        deps.listen((docs) => sendBack({ type: "remote", docs })),
      ),
    },
    actions: {
      keySaved: assign({
        npub: ({ event }) => (event as unknown as { output: string }).output,
        keyError: undefined,
      }),
      keyFailed: assign({
        keyError: ({ event }) => String((event as unknown as { error: unknown }).error),
      }),
      apply: assign(({ context }, op: Op) => {
        try {
          const changed = op(editCtx(context));
          if (!changed.length) return {};
          deps.save(changed, true).catch((e) => console.error("save failed", e));
          return { docs: applied(context.docs, changed), error: undefined };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      }),
      spawnRepeats: assign(({ context }) => {
        const changed = spawnDue(editCtx(context));
        if (!changed.length) return {};
        deps.save(changed, true).catch((e) => console.error("save failed", e));
        return { docs: applied(context.docs, changed) };
      }),
    },
  }).createMachine({
    id: "stuff",
    type: "parallel",
    context: {
      clock: hlc(randomId().slice(0, 8), now),
      docs: new Map(),
      today: today(),
      now,
      view,
      selection: [],
      editing: null,
    },
    on: {
      view: { actions: assign({ view: ({ event }) => event.view, selection: [], editing: null }) },
      select: { actions: assign({ selection: ({ event }) => event.ids }) },
      edit: {
        actions: assign({
          editing: ({ event }) => event.id,
          selection: ({ event, context }) => (event.id ? [event.id] : context.selection),
        }),
      },
    },
    states: {
      key: {
        initial: "checking",
        states: {
          checking: {
            invoke: {
              src: "keyStatus",
              onDone: [
                {
                  guard: ({ event }) => !!event.output,
                  target: "ready",
                  actions: assign({ npub: ({ event }) => event.output ?? undefined }),
                },
                { target: "missing" },
              ],
              onError: keyFailed,
            },
          },
          missing: { on: { "key.create": "creating", "key.import": "importing" } },
          creating: {
            invoke: {
              src: "saveKey",
              input: { command: "generate_key" },
              onDone: keySaved,
              onError: keyFailed,
            },
          },
          importing: {
            invoke: {
              src: "saveKey",
              input: ({ event }) => ({
                command: "import_key" as const,
                nsec: event.type === "key.import" ? event.nsec : "",
              }),
              onDone: keySaved,
              onError: keyFailed,
            },
          },
          ready: {},
        },
      },
      data: {
        initial: "loading",
        states: {
          loading: {
            invoke: {
              src: "load",
              onDone: {
                target: "ready",
                actions: assign({
                  docs: ({ event }) =>
                    new Map(event.output.flatMap((x) => parseDoc(x) ?? []).map((d) => [d.id, d])),
                }),
              },
              onError: {
                target: "failed",
                actions: assign({ error: ({ event }) => String(event.error) }),
              },
            },
          },
          failed: {},
          ready: {
            entry: "spawnRepeats",
            invoke: { src: "listen" },
            on: {
              change: {
                actions: {
                  type: "apply",
                  params: ({ event }: { event: Extract<Event, { type: "change" }> }) => event.op,
                },
              },
              remote: {
                actions: assign({
                  docs: ({ context, event }) => {
                    let docs = context.docs;
                    for (const raw of event.docs) {
                      const remote = parseDoc(raw);
                      if (!remote) continue;
                      const local = docs.get(remote.id);
                      const merged = merge(local, remote, context.clock);
                      if (local && equal(local, merged)) continue;
                      if (docs === context.docs) docs = new Map(docs);
                      docs.set(remote.id, merged);
                    }
                    return docs;
                  },
                }),
              },
              tick: { actions: [assign({ today }), "spawnRepeats"] },
            },
          },
        },
      },
    },
  });
}
