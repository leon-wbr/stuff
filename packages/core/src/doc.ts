import type { Clock } from "./hlc";
import { DEFAULTS, type Fields, type Id, type Item, type ItemOf, type Type } from "./model";

export interface Stamped {
  v: unknown;
  c: string;
}

/** A synced object: every field carries the HLC stamp of its last write. */
export interface Doc {
  id: Id;
  type: Type;
  f: Record<string, Stamped>;
  deleted?: boolean;
}

export type Patch<K extends Type = Type> = Partial<Fields<ItemOf<K>>>;

export function update(doc: Doc, patch: Record<string, unknown>, clock: Clock): Doc {
  const f = { ...doc.f };
  for (const [key, v] of Object.entries(patch)) if (v !== undefined) f[key] = { v, c: clock.now() };
  return { ...doc, f };
}

export const create = <K extends Type>(type: K, id: Id, fields: Patch<K>, clock: Clock): Doc =>
  update({ id, type, f: {} }, fields, clock);

export const remove = (doc: Doc, clock: Clock): Doc => ({
  ...update(doc, {}, clock),
  deleted: true,
});

/** Per-field last-writer-wins; deletion is sticky. Observing remote stamps keeps `clock` ahead of them. */
export function merge(local: Doc | undefined, remote: Doc, clock?: Clock): Doc {
  for (const s of Object.values(remote.f)) clock?.observe(s.c);
  if (!local) return remote;
  const f = { ...local.f };
  for (const [key, theirs] of Object.entries(remote.f)) {
    const ours = f[key];
    if (!ours || theirs.c > ours.c) f[key] = theirs;
  }
  return {
    id: local.id,
    type: local.type,
    f,
    ...((local.deleted || remote.deleted) && { deleted: true }),
  };
}

export function equal(a: Doc, b: Doc) {
  if (!!a.deleted !== !!b.deleted) return false;
  const keys = new Set([...Object.keys(a.f), ...Object.keys(b.f)]);
  return [...keys].every((k) => a.f[k]?.c === b.f[k]?.c);
}

export function materialize<T extends Item = Item>(doc: Doc): T {
  const item: Record<string, unknown> = { id: doc.id, type: doc.type, ...DEFAULTS[doc.type] };
  for (const [key, s] of Object.entries(doc.f)) if (key in item) item[key] = s.v;
  return item as unknown as T;
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

export function parseDoc(x: unknown): Doc | undefined {
  if (!isRecord(x) || typeof x.id !== "string" || !x.id) return;
  if (typeof x.type !== "string" || !(x.type in DEFAULTS) || !isRecord(x.f)) return;
  for (const s of Object.values(x.f)) if (!isRecord(s) || typeof s.c !== "string") return;
  return {
    id: x.id,
    type: x.type as Type,
    f: x.f as Record<string, Stamped>,
    ...(x.deleted === true && { deleted: true }),
  };
}
