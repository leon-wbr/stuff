import { remove, update, type Doc } from "./doc";
import { DEFAULTS, type Id } from "./model";
import type { Op } from "./ops";

/** What one edit changed: each document before (undefined if the edit created it) and after. */
export interface Entry {
  before: (Doc | undefined)[];
  after: Doc[];
}

export const record = (docs: Map<Id, Doc>, changed: Doc[]): Entry => ({
  before: changed.map((d) => docs.get(d.id)),
  after: changed,
});

/**
 * Writes the "before" values back with fresh stamps, so the undo syncs like any edit. A field
 * changed again since (here or on another Mac) is left alone, and tombstones stay tombstones.
 */
export const revert =
  (entry: Entry): Op =>
  (ctx) =>
    entry.after.flatMap((after, i) => {
      const cur = ctx.docs.get(after.id);
      if (!cur || cur.deleted) return [];
      const before = entry.before[i];
      if (!before) return [remove(cur, ctx.clock)];
      const defaults = DEFAULTS[cur.type] as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [key, s] of Object.entries(after.f))
        if (cur.f[key]?.c === s.c && before.f[key]?.c !== s.c)
          patch[key] = before.f[key] ? before.f[key].v : (defaults[key] ?? null);
      return Object.keys(patch).length ? [update(cur, patch, ctx.clock)] : [];
    });
