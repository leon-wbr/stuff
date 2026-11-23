import type { Doc } from "@stuff/core/doc";
import {
  adapterFor,
  parseSyncConfig,
  stuff,
  type SyncConfig,
  type SyncEnv,
} from "@stuff/core/extensions";
import type { FolderFs } from "@stuff/core/folder";
import { enabledRelays, relayPool } from "@stuff/core/relays";
import { createSync, type SyncStatus } from "@stuff/core/sync";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { decode } from "nostr-tools/nip19";
import { useEffect, useState, useSyncExternalStore } from "react";
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
  if (s.state === "error") return { text: `Not synced: ${s.error}`, color: "bg-destructive" };
  return { text: "Sync is off: everything stays on this Mac", color: "bg-muted-foreground/40" };
}

/** This Mac's sync choice (meta `sync`). Before there was a choice, a stored key meant Nostr. */
export function useSyncConfig(): SyncConfig | undefined {
  const npub = Stuff.useSelector((s) => s.context.npub);
  const [stored, setStored] = useState<string | null | undefined>();
  useEffect(() => {
    void invoke<string | null>("meta_get", { key: "sync" }).then(setStored);
    const off = listen<string>("sync-config", ({ payload }) => setStored(payload));
    return () => void off.then((f) => f());
  }, []);
  if (stored === undefined) return;
  return stored === null && npub ? { adapter: "nostr" } : parseSyncConfig(stored);
}

export async function setSyncConfig(config: SyncConfig) {
  const value = JSON.stringify(config);
  await invoke("meta_set", { key: "sync", value });
  await emit("sync-config", value);
}

const folderFs = (path: string): FolderFs => ({
  list: () => invoke("folder_list", { path }),
  stat: (name) => invoke("folder_stat", { path, name }),
  read: (name) => invoke("folder_read", { path, name }),
  write: (name, text) => invoke("folder_write", { path, name, text }),
});

/** Runs the sync loop in the primary window with this Mac's adapter: push dirty objects, merge what arrives. */
export function useSync() {
  const npub = Stuff.useSelector((s) => s.context.npub);
  const actor = Stuff.useActorRef();
  const relays = enabledRelays(useWorld().settings?.relays).join(" ");
  const config = useSyncConfig();
  const configKey = config && JSON.stringify(config);
  useEffect(() => {
    if (!isPrimary || !configKey) return;
    const urls = relays.split(" ").filter(Boolean);
    const env: SyncEnv = {
      ...(npub && {
        pubkey: decode(npub).data as string,
        vault: {
          seal: (id, plaintext, createdAt) => invoke("seal_object", { id, plaintext, createdAt }),
          open: (event) => invoke("open_object", { event }),
        },
      }),
      relays: () => relayPool(() => urls),
      folder: folderFs,
    };
    let adapter;
    try {
      adapter = adapterFor(stuff, JSON.parse(configKey) as SyncConfig, env);
    } catch (e) {
      setStatus({ state: "error", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!adapter) return setStatus({ state: "off" });
    const engine = createSync({
      adapter,
      dirty: () => invoke("store_dirty"),
      clean: (published) => invoke("store_clean", { published }),
      save: (docs: Doc[], dirty) => invoke("store_save", { docs, dirty }),
      current: (id) => actor.getSnapshot().context.docs.get(id),
      all: () => actor.getSnapshot().context.docs.values(),
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
    const cursor = `cursor:${adapter.key}`;
    void (async () => {
      // Nostr kept its cursor as `lastSync` before adapters existed.
      const legacy =
        adapter.key.startsWith("nostr:") && (await invoke("meta_get", { key: "lastSync" }));
      if (legacy && !(await invoke("meta_get", { key: cursor })))
        await invoke("meta_set", { key: cursor, value: legacy });
      await engine.start();
    })().catch((e) => setStatus({ state: "error", error: String(e) }));
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      void off.then((f) => f());
      engine.stop();
    };
  }, [npub, relays, actor, configKey]);
}
