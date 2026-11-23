import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/pure";
import { equal, merge, parseDoc, type Doc } from "./doc";
import type { Clock } from "./hlc";
import type { Id } from "./model";

export const KIND = 30078;
export const APP_TAG = "stuff";
/** Re-read this far behind the last sync, for events that reached a relay late. */
const OVERLAP = 600;

export interface Relays {
  subscribe(filter: Filter, onEvent: (e: Event) => void, onEose: () => void): () => void;
  publish(event: Event): Promise<void>;
}

export interface SyncDeps {
  pubkey: string;
  relays: Relays;
  /** Encrypts to self and signs, in Rust. */
  seal(id: Id, plaintext: string, createdAt: number): Promise<Event>;
  /** Verifies and decrypts, in Rust. */
  open(event: Event): Promise<string>;
  dirty(): Promise<{ doc: Doc; rev: number }[]>;
  clean(published: { id: Id; rev: number }[]): Promise<void>;
  save(docs: Doc[], dirty: boolean): Promise<void>;
  current(id: Id): Doc | undefined;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  clock?: Clock;
  now?(): number;
  onStatus?(status: SyncStatus): void;
}

export type SyncStatus =
  | { state: "connecting" }
  | { state: "synced"; at: number }
  | { state: "error"; error: string };

export function createSync(deps: SyncDeps) {
  const now = () => Math.floor((deps.now?.() ?? Date.now()) / 1000);
  /** Newest created_at seen per object, so our replacement is always newer than the relay's copy. */
  const seen = new Map<Id, number>();
  let lastSync = 0;
  let close: (() => void) | undefined;
  let flushing: Promise<void> | undefined;
  let again = false;

  async function receive(event: Event) {
    const d = event.tags.find((t) => t[0] === "d")?.[1];
    if (event.kind !== KIND || event.pubkey !== deps.pubkey || !d) return;
    seen.set(d, Math.max(seen.get(d) ?? 0, event.created_at));
    let remote: Doc | undefined;
    try {
      remote = parseDoc(JSON.parse(await deps.open(event)));
    } catch {
      return;
    }
    if (!remote || remote.id !== d) return;
    const local = deps.current(d);
    const merged = merge(local, remote, deps.clock);
    const newer = !equal(merged, remote);
    if (local && equal(local, merged)) {
      if (newer) await deps.save([merged], true);
    } else await deps.save([merged], newer);
    if (event.created_at > lastSync) lastSync = event.created_at;
  }

  async function publishDirty() {
    const dirty = await deps.dirty();
    const published: { id: Id; rev: number }[] = [];
    let failed: unknown;
    for (const { doc, rev } of dirty) {
      const createdAt = Math.max(now(), (seen.get(doc.id) ?? 0) + 1);
      try {
        const event = await deps.seal(doc.id, JSON.stringify(doc), createdAt);
        await deps.relays.publish(event);
        seen.set(doc.id, createdAt);
        published.push({ id: doc.id, rev });
      } catch (e) {
        failed = e;
      }
    }
    if (published.length) await deps.clean(published);
    if (failed) throw failed;
  }

  /** Publishes dirty objects; calls made while one runs are coalesced into one more run. */
  function flush(): Promise<void> {
    if (flushing) {
      again = true;
      return flushing;
    }
    flushing = (async () => {
      try {
        do {
          again = false;
          await publishDirty();
        } while (again);
        deps.onStatus?.({ state: "synced", at: Date.now() });
      } catch (e) {
        deps.onStatus?.({ state: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        flushing = undefined;
      }
    })();
    return flushing;
  }

  async function start() {
    deps.onStatus?.({ state: "connecting" });
    lastSync = Number((await deps.getMeta("lastSync")) ?? 0);
    const queue: Event[] = [];
    let draining: Promise<void> | undefined;
    const drain = async () => {
      while (queue.length) await receive(queue.shift()!);
      await deps.setMeta("lastSync", String(lastSync));
      draining = undefined;
    };
    await new Promise<void>((resolve) => {
      close = deps.relays.subscribe(
        {
          kinds: [KIND],
          authors: [deps.pubkey],
          "#t": [APP_TAG],
          ...(lastSync && { since: lastSync - OVERLAP }),
        },
        (event) => {
          queue.push(event);
          draining ??= drain();
        },
        () => void (draining ?? Promise.resolve()).then(resolve),
      );
    });
    await draining;
    await flush();
  }

  return {
    start,
    flush,
    stop: () => close?.(),
  };
}
