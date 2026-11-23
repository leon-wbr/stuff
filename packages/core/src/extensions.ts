import { backupJson, restoreBackup } from "./backup";
import { commands, type CommandDef } from "./commands";
import type { Doc } from "./doc";
import { folderAdapter, type FolderFs } from "./folder";
import { nostrAdapter, type Relays, type Vault } from "./nostr";
import type { Op } from "./ops";
import type { SyncAdapter } from "./sync";
import { importThings, type ThingsData } from "./things";

/** Brings data in. `input` names what the host supplies: a file's text, or the rows things.rs reads. */
export interface Importer<I = never> {
  id: string;
  title: string;
  input: "text" | "things";
  op(input: I): Op;
}

export interface Exporter {
  id: string;
  title: string;
  extension: string;
  run(docs: Iterable<Doc>): string;
}

/** Per-Mac sync choice, kept in the store's meta table under `sync`. */
export type SyncConfig = { adapter: string; path?: string; encrypt?: boolean };

/** What the host offers adapters: the key's operations and transports. */
export interface SyncEnv {
  pubkey?: string;
  vault?: Vault;
  relays(): Relays;
  folder(path: string): FolderFs;
}

export interface SyncAdapterDef {
  id: string;
  title: string;
  /** Throws with a readable message when the config or the Mac isn't ready (no key, no folder). */
  create(config: SyncConfig, env: SyncEnv): SyncAdapter;
}

export interface Extension {
  id: string;
  commands?: CommandDef[];
  importers?: Importer<any>[];
  exporters?: Exporter[];
  syncAdapters?: SyncAdapterDef[];
}

const needKey = (env: SyncEnv) => {
  if (!env.pubkey || !env.vault) throw new Error("Set up a key first");
  return { pubkey: env.pubkey, vault: env.vault };
};

export const builtins: Extension[] = [
  { id: "core", commands },
  {
    id: "nostr",
    syncAdapters: [
      {
        id: "nostr",
        title: "Nostr",
        create: (_, env) => nostrAdapter({ ...needKey(env), relays: env.relays() }),
      },
    ],
  },
  {
    id: "folder",
    syncAdapters: [
      {
        id: "folder",
        title: "Folder",
        create(config, env) {
          if (!config.path) throw new Error("Choose a folder first");
          return folderAdapter({
            path: config.path,
            fs: env.folder(config.path),
            ...(config.encrypt ? { ...needKey(env), encrypt: true } : { vault: env.vault }),
          });
        },
      },
    ],
  },
  {
    id: "backup",
    importers: [
      {
        id: "json",
        title: "stuff backup (JSON)",
        input: "text",
        op: (text: string) => restoreBackup(text),
      },
    ],
    exporters: [{ id: "json", title: "stuff backup (JSON)", extension: "json", run: backupJson }],
  },
  {
    id: "things",
    importers: [
      {
        id: "things",
        title: "Things",
        input: "things",
        op: (data: ThingsData) => importThings(data),
      },
    ],
  },
];

function index<T extends { id?: string; name?: string }>(items: T[], what: string) {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = item.name ?? item.id!;
    if (map.has(key)) throw new Error(`Two ${what} are named "${key}"`);
    map.set(key, item);
  }
  return map;
}

/** Indexes extensions by id; names must be unique across extensions. */
export function registry(extensions: Extension[]) {
  index(extensions, "extensions");
  return {
    extensions,
    commands: index(
      extensions.flatMap((e) => e.commands ?? []),
      "commands",
    ),
    importers: index(
      extensions.flatMap((e) => e.importers ?? []),
      "importers",
    ),
    exporters: index(
      extensions.flatMap((e) => e.exporters ?? []),
      "exporters",
    ),
    syncAdapters: index(
      extensions.flatMap((e) => e.syncAdapters ?? []),
      "sync adapters",
    ),
  };
}

export type Registry = ReturnType<typeof registry>;

/** The registry of the built-in extensions; the app and the CLI both use it. */
export const stuff = registry(builtins);

/** The adapter for a Mac's sync config, or undefined when sync is off. */
export function adapterFor(reg: Registry, config: SyncConfig, env: SyncEnv) {
  if (config.adapter === "off") return;
  const def = reg.syncAdapters.get(config.adapter);
  if (!def) throw new Error(`No sync adapter "${config.adapter}"`);
  return def.create(config, env);
}

export const parseSyncConfig = (text: string | null): SyncConfig => {
  try {
    const c = JSON.parse(text ?? "") as SyncConfig;
    if (typeof c.adapter === "string") return c;
  } catch {
    // Not set yet.
  }
  return { adapter: "off" };
};
