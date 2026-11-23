import type { Doc } from "@stuff/core/doc";
import { enabledRelays, relayPool } from "@stuff/core/relays";
import { createSync, type SyncStatus } from "@stuff/core/sync";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { decode } from "nostr-tools/nip19";
import { useEffect, useSyncExternalStore } from "react";
import { isPrimary, Stuff, useWorld } from "./app.ts";

let status: SyncStatus | { state: "off" } = { state: "off" };
const watchers = new Set<() => void>();
const setStatus = (s: typeof status) => {
  status = s;
  for (const w of watchers) w();
};

export function useSyncStatus() {
  const s = useSyncExternalStore(
    (fn) => (watchers.add(fn), () => watchers.delete(fn)),
    () => status,
  );
  if (s.state === "synced")
    return { text: `Synced ${new Date(s.at).toLocaleTimeString()}`, color: "bg-primary" };
  if (s.state === "connecting") return { text: "Connecting…", color: "bg-today" };
  if (s.state === "error") return { text: `Sync problem: ${s.error}`, color: "bg-destructive" };
  return { text: "Sync is off: set up a key in Settings", color: "bg-muted-foreground/40" };
}

/** Runs the sync loop in the primary window once there's a key: publish dirty objects, merge what arrives. */
export function useSync() {
  const npub = Stuff.useSelector((s) => s.context.npub);
  const actor = Stuff.useActorRef();
  const relays = enabledRelays(useWorld().settings?.relays).join(" ");
  useEffect(() => {
    if (!isPrimary || !npub) return;
    const urls = relays.split(" ").filter(Boolean);
    const engine = createSync({
      pubkey: decode(npub).data as string,
      relays: relayPool(() => urls),
      seal: (id, plaintext, createdAt) => invoke("seal_object", { id, plaintext, createdAt }),
      open: (event) => invoke("open_object", { event }),
      dirty: () => invoke("store_dirty"),
      clean: (published) => invoke("store_clean", { published }),
      save: (docs: Doc[], dirty) => invoke("store_save", { docs, dirty }),
      current: (id) => actor.getSnapshot().context.docs.get(id),
      getMeta: (key) => invoke("meta_get", { key }),
      setMeta: (key, value) => invoke("meta_set", { key, value }),
      clock: actor.getSnapshot().context.clock,
      onStatus: setStatus,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void engine.flush(), 1500);
    };
    const off = listen("store-changed", soon);
    const interval = setInterval(() => void engine.flush(), 60_000);
    void engine.start().catch((e) => setStatus({ state: "error", error: String(e) }));
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      void off.then((f) => f());
      engine.stop();
    };
  }, [npub, relays, actor]);
}
