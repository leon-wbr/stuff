import type { Event } from "nostr-tools/pure";
import { merge, parseDoc, type Doc } from "./doc";
import { openSealed, type Vault } from "./nostr";
import type { SyncAdapter } from "./sync";

export interface FileStat {
  mtime: number;
  size: number;
}

/** A directory, supplied by the host (Rust commands in the app, node:fs in the CLI and tests). */
export interface FolderFs {
  list(): Promise<({ name: string } & FileStat)[]>;
  stat(name: string): Promise<FileStat | null>;
  read(name: string): Promise<string>;
  /** Replaces the file atomically. */
  write(name: string, text: string): Promise<FileStat>;
}

const sig = (s: FileStat) => `${s.mtime}:${s.size}`;
const isObjectFile = (name: string) => name.endsWith(".json") && !name.startsWith(".");

/**
 * One file per object, `<id>.json`, in a folder that a cloud drive (iCloud Drive, Google Drive,
 * Dropbox, Syncthing) syncs. Files are the document JSON, or with `encrypt` the sealed event Nostr
 * uses. Any other `.json` (a drive's conflicted copy) is merged in by the id inside.
 */
export function folderAdapter(opts: {
  path: string;
  fs: FolderFs;
  vault?: Vault;
  encrypt?: boolean;
  interval?: number;
}): SyncAdapter {
  const { fs, vault } = opts;
  /** File name → mtime:size of the version already read or written. Serves as the cursor. */
  let seen: Record<string, string> = {};
  /** Remote versions found while pushing, delivered on the next poll. */
  let found: Doc[] = [];

  async function decode(text: string): Promise<Doc | undefined> {
    const x = JSON.parse(text) as unknown;
    if (x && typeof x === "object" && "sig" in x) {
      if (!vault) throw new Error("This folder is encrypted; set up your key to read it");
      return openSealed(vault, x as Event);
    }
    return parseDoc(x);
  }

  const encode = async (doc: Doc) =>
    opts.encrypt && vault
      ? JSON.stringify(await vault.seal(doc.id, JSON.stringify(doc), Math.floor(Date.now() / 1000)))
      : JSON.stringify(doc);

  return {
    key: `folder:${opts.path}`,
    watch(cursor, on) {
      seen = cursor ? (JSON.parse(cursor) as Record<string, string>) : {};
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const poll = async () => {
        try {
          const docs = found;
          found = [];
          let changed = docs.length > 0;
          for (const file of await fs.list()) {
            if (!isObjectFile(file.name) || seen[file.name] === sig(file)) continue;
            changed = true;
            seen[file.name] = sig(file);
            const doc = await decode(await fs.read(file.name)).catch(() => undefined);
            if (doc) docs.push(doc);
          }
          if (changed) await on.changes(docs, JSON.stringify(seen));
        } catch (e) {
          on.error(e);
        }
      };
      const loop = async () => {
        await poll();
        if (!stopped) timer = setTimeout(loop, opts.interval ?? 5000);
      };
      void poll().then(() => {
        on.ready();
        if (!stopped) timer = setTimeout(loop, opts.interval ?? 5000);
      });
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    },
    async push(doc) {
      const name = `${doc.id}.json`;
      const now = await fs.stat(name);
      if (now && seen[name] !== sig(now)) {
        const theirs = await decode(await fs.read(name)).catch(() => undefined);
        if (theirs?.id === doc.id) {
          found.push(theirs);
          doc = merge(theirs, doc);
        }
      }
      seen[name] = sig(await fs.write(name, await encode(doc)));
    },
    async check() {
      await fs.list();
    },
  };
}
