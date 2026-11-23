import { SimplePool } from "nostr-tools/pool";
import type { RelaySetting } from "./model";
import type { Relays } from "./nostr";

export const DEFAULT_RELAYS: RelaySetting[] = [
  { url: "wss://relay.anchorman.lol", enabled: true },
  { url: "wss://relay.nostr.net", enabled: true },
  { url: "wss://relay.primal.net", enabled: true },
];

export function normalizeRelay(input: string): string | undefined {
  const text = input.trim();
  if (!text) return;
  try {
    const url = new URL(text.includes("://") ? text : `wss://${text}`);
    const local = url.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((url.protocol !== "wss:" && !local) || !url.hostname) return;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch {
    return;
  }
}

export const enabledRelays = (relays: RelaySetting[] | null | undefined) =>
  (relays ?? DEFAULT_RELAYS).filter((r) => r.enabled).map((r) => r.url);

/** The only module that talks to relays. */
export function relayPool(urls: () => string[]): Relays {
  const pool = new SimplePool();
  return {
    subscribe(filter, onEvent, onEose) {
      const sub = pool.subscribeMany(urls(), filter, { onevent: onEvent, oneose: onEose });
      return () => sub.close();
    },
    async publish(event) {
      const targets = urls();
      if (!targets.length) throw new Error("No relays are enabled");
      await Promise.any(pool.publish(targets, event)).catch(() => {
        throw new Error("No relay accepted the update");
      });
    },
    async check() {
      const targets = urls();
      if (!targets.length) throw new Error("No relays are enabled");
      await Promise.any(
        targets.map((url) => pool.ensureRelay(url, { connectionTimeout: 5000 })),
      ).catch(() => {
        throw new Error("No relay is reachable");
      });
    },
  };
}
