import { equal, merge, type Doc } from "./doc";
import type { Clock } from "./hlc";
import type { Id } from "./model";

/** Where documents are synced to. See docs/extensibility.md. */
export interface SyncAdapter {
  /** Stable per remote (`nostr:<pubkey>`, `folder:<path>`); the engine keeps one cursor per key. */
  key: string;
  /** Reads everything after `cursor`, calls `ready` once caught up, then delivers changes until stopped. */
  watch(cursor: string | null, on: WatchHandlers): () => void;
  /** Stores one document remotely. */
  push(doc: Doc): Promise<void>;
  /** Throws with a readable message when the remote can't be reached right now. */
  check(): Promise<void>;
}

export interface WatchHandlers {
  changes(docs: Doc[], cursor: string): Promise<void>;
  ready(): void;
  error(e: unknown): void;
}

export interface SyncDeps {
  adapter: SyncAdapter;
  dirty(): Promise<{ doc: Doc; rev: number }[]>;
  clean(published: { id: Id; rev: number }[]): Promise<void>;
  save(docs: Doc[], dirty: boolean): Promise<void>;
  current(id: Id): Doc | undefined;
  all(): Iterable<Doc>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  clock?: Clock;
  onStatus?(status: SyncStatus): void;
}

export type SyncStatus =
  | { state: "connecting" }
  | { state: "synced"; at: number }
  | { state: "error"; error: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createSync(deps: SyncDeps) {
  const { adapter } = deps;
  const cursorKey = `cursor:${adapter.key}`;
  let stop: (() => void) | undefined;
  let flushing: Promise<void> | undefined;
  let again = false;
  /** Received batches are merged one after another, in arrival order. */
  let received = Promise.resolve();

  async function receive(docs: Doc[], cursor: string) {
    for (const remote of docs) {
      const local = deps.current(remote.id);
      const merged = merge(local, remote, deps.clock);
      const newer = !equal(merged, remote);
      if (local && equal(local, merged)) {
        if (newer) await deps.save([merged], true);
      } else await deps.save([merged], newer);
    }
    await deps.setMeta(cursorKey, cursor);
  }

  async function push(docs: { doc: Doc; rev?: number }[]) {
    const published: { id: Id; rev: number }[] = [];
    let failed: unknown;
    for (const { doc, rev } of docs) {
      try {
        await adapter.push(doc);
        if (rev !== undefined) published.push({ id: doc.id, rev });
      } catch (e) {
        failed = e;
      }
    }
    if (published.length) await deps.clean(published);
    if (failed) throw failed;
  }

  /** Pushes dirty documents; calls made while one runs are coalesced into one more run. */
  function flush(): Promise<void> {
    if (flushing) {
      again = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        do {
          again = false;
          await push(await deps.dirty());
        } while (again);
        await adapter.check();
        deps.onStatus?.({ state: "synced", at: Date.now() });
      } catch (e) {
        deps.onStatus?.({ state: "error", error: message(e) });
      } finally {
        flushing = undefined;
      }
    })();
    return flushing;
  }

  async function start() {
    deps.onStatus?.({ state: "connecting" });
    const cursor = await deps.getMeta(cursorKey);
    await new Promise<void>((resolve) => {
      stop = adapter.watch(cursor, {
        changes: (docs, next) => (received = received.then(() => receive(docs, next))),
        ready: () => void received.then(resolve),
        error: (e) => deps.onStatus?.({ state: "error", error: message(e) }),
      });
    });
    if (cursor === null) {
      try {
        await push([...deps.all()].map((doc) => ({ doc })));
        if ((await deps.getMeta(cursorKey)) === null) await deps.setMeta(cursorKey, "");
      } catch {
        // Retried on the next start, since no cursor was stored.
      }
    }
    await flush();
  }

  return {
    start,
    flush,
    stop: () => stop?.(),
  };
}
