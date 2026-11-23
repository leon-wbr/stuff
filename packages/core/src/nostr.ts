import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/pure";
import { parseDoc, type Doc } from "./doc";
import type { Id } from "./model";
import type { SyncAdapter } from "./sync";

export const KIND = 30078;
export const APP_TAG = "stuff";
/** Re-read this far behind the cursor, for events that reached a relay late. */
const OVERLAP = 600;

export interface Relays {
  subscribe(filter: Filter, onEvent: (e: Event) => void, onEose: () => void): () => void;
  publish(event: Event): Promise<void>;
  check(): Promise<void>;
}

/** The key's operations, done in Rust by vault.rs: encrypt to self and sign, verify and decrypt. */
export interface Vault {
  seal(id: Id, plaintext: string, createdAt: number): Promise<Event>;
  open(event: Event): Promise<string>;
}

/** Opens a sealed object, or returns undefined when it isn't a valid one of ours. */
export async function openSealed(vault: Vault, event: Event, pubkey?: string) {
  const d = event.tags?.find((t) => t[0] === "d")?.[1];
  if (event.kind !== KIND || (pubkey && event.pubkey !== pubkey) || !d) return;
  try {
    const doc = parseDoc(JSON.parse(await vault.open(event)));
    return doc?.id === d ? doc : undefined;
  } catch {
    return;
  }
}

/** Each document is a kind 30078 event (`d` = id, `t` = stuff) NIP-44 encrypted to the user's own key. */
export function nostrAdapter(opts: {
  pubkey: string;
  relays: Relays;
  vault: Vault;
  now?: () => number;
}): SyncAdapter {
  const { pubkey, relays, vault } = opts;
  const now = () => Math.floor((opts.now?.() ?? Date.now()) / 1000);
  /** Newest created_at seen per object, so our replacement is always newer than the relay's copy. */
  const seen = new Map<Id, number>();
  return {
    key: `nostr:${pubkey}`,
    watch(cursor, on) {
      let last = Number(cursor || 0);
      let queue = Promise.resolve();
      const receive = async (event: Event) => {
        const d = event.tags.find((t) => t[0] === "d")?.[1];
        if (d) seen.set(d, Math.max(seen.get(d) ?? 0, event.created_at));
        const doc = await openSealed(vault, event, pubkey);
        if (!doc) return;
        last = Math.max(last, event.created_at);
        await on.changes([doc], String(last));
      };
      return relays.subscribe(
        {
          kinds: [KIND],
          authors: [pubkey],
          "#t": [APP_TAG],
          ...(last && { since: last - OVERLAP }),
        },
        (event) => void (queue = queue.then(() => receive(event))),
        () => void queue.then(on.ready),
      );
    },
    async push(doc: Doc) {
      const createdAt = Math.max(now(), (seen.get(doc.id) ?? 0) + 1);
      await relays.publish(await vault.seal(doc.id, JSON.stringify(doc), createdAt));
      seen.set(doc.id, createdAt);
    },
    check: () => relays.check(),
  };
}
