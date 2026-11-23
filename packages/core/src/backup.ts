import { equal, merge, parseDoc, type Doc } from "./doc";
import type { Op } from "./ops";

export const BACKUP_FORMAT = "stuff-backup";

export const backupJson = (docs: Iterable<Doc>) =>
  JSON.stringify({ format: BACKUP_FORMAT, version: 1, docs: [...docs] });

/** Merges a backup into the current documents, so restoring never loses newer edits. */
export const restoreBackup =
  (text: string): Op =>
  (ctx) => {
    const data = JSON.parse(text) as { format?: unknown; docs?: unknown };
    if (data.format !== BACKUP_FORMAT || !Array.isArray(data.docs))
      throw new Error("This isn't a stuff backup");
    const out: Doc[] = [];
    for (const raw of data.docs) {
      const doc = parseDoc(raw);
      if (!doc) continue;
      const local = ctx.docs.get(doc.id);
      const merged = merge(local, doc, ctx.clock);
      if (!local || !equal(local, merged)) out.push(merged);
    }
    return out;
  };
