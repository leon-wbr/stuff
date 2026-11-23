import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { merge, parseDoc, type Doc } from "@stuff/core/doc";

/** The app's SQLite store (see `store.rs`), opened the same way: WAL, busy timeout, merging writes. */
export function openStore(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, doc TEXT NOT NULL, dirty INTEGER NOT NULL, rev INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const one = <T>(sql: string, ...params: (string | number)[]) =>
    db.prepare(sql).get(...params) as T | undefined;
  const maxRev = () => one<{ r: number }>("SELECT COALESCE(MAX(rev), 0) AS r FROM objects")!.r;
  const version = () => one<{ data_version: number }>("PRAGMA data_version")!.data_version;
  let seen = { version: version(), rev: maxRev() };
  let depth = 0;

  const rows = (sql: string, ...params: number[]) =>
    (db.prepare(sql).all(...params) as { doc: string; rev: number }[]).flatMap((r) => {
      const doc = parseDoc(JSON.parse(r.doc));
      return doc ? [{ doc, rev: r.rev }] : [];
    });

  /** Runs `fn` holding the write lock (BEGIN IMMEDIATE), so a load-edit-save can't interleave. */
  function transaction<T>(fn: () => T): T {
    if (depth) return fn();
    db.exec("BEGIN IMMEDIATE");
    depth++;
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      depth--;
    }
  }

  return {
    path,
    transaction,
    load: () => rows("SELECT doc, rev FROM objects").map((r) => r.doc),
    /** Writes documents merged with the stored ones; returns what was written. */
    save: (docs: Doc[], dirty: boolean) =>
      transaction(() => {
        const rev = maxRev() + 1;
        const insert = db.prepare(
          `INSERT INTO objects (id, doc, dirty, rev) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, dirty = excluded.dirty, rev = excluded.rev`,
        );
        return docs.map((doc) => {
          const stored = one<{ doc: string }>("SELECT doc FROM objects WHERE id = ?", doc.id);
          const local = stored && parseDoc(JSON.parse(stored.doc));
          const merged = local ? merge(local, doc) : doc;
          insert.run(merged.id, JSON.stringify(merged), dirty ? 1 : 0, rev);
          return merged;
        });
      }),
    dirty: () => rows("SELECT doc, rev FROM objects WHERE dirty = 1"),
    clean(published: { id: string; rev: number }[]) {
      const stmt = db.prepare("UPDATE objects SET dirty = 0 WHERE id = ? AND rev = ?");
      for (const p of published) stmt.run(p.id, p.rev);
    },
    meta: (key: string) =>
      one<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? null,
    setMeta(key: string, value: string) {
      db.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },
    /** Documents other connections wrote since the last call, like `Store::external_changes`. */
    externalChanges(): Doc[] {
      const v = version();
      if (v === seen.version) return [];
      const changed = rows("SELECT doc, rev FROM objects WHERE rev > ?", seen.rev);
      seen = { version: v, rev: Math.max(seen.rev, ...changed.map((r) => r.rev)) };
      return changed.map((r) => r.doc);
    },
    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
