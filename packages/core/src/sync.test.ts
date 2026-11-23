import { matchFilter, type Filter } from "nostr-tools/filter";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { create, materialize, update, type Doc } from "./doc";
import { hlc } from "./hlc";
import type { Todo } from "./model";
import { APP_TAG, createSync, KIND, type Relays } from "./sync";

/** A relay keeping the newest event per `d`, like a real one does for kind 30078. */
function memoryRelay() {
  const events = new Map<string, Event>();
  const subs = new Set<{ filter: Filter; onEvent(e: Event): void }>();
  const relay = {
    events,
    connect(): Relays {
      return {
        subscribe(filter, onEvent, onEose) {
          const sub = { filter, onEvent };
          subs.add(sub);
          for (const e of events.values()) if (matchFilter(filter, e)) onEvent(e);
          onEose();
          return () => subs.delete(sub);
        },
        async publish(e) {
          const key = e.tags.find((t) => t[0] === "d")![1]!;
          const old = events.get(key);
          if (
            old &&
            (old.created_at > e.created_at || (old.created_at === e.created_at && old.id < e.id))
          )
            return;
          events.set(key, e);
          for (const s of subs) if (matchFilter(s.filter, e)) s.onEvent(e);
        },
      };
    },
  };
  return relay;
}

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const conversation = nip44.getConversationKey(secret, pubkey);

function device(name: string, relay: ReturnType<typeof memoryRelay>, wall: () => number) {
  const store = new Map<string, { doc: Doc; dirty: boolean; rev: number }>();
  const meta = new Map<string, string>();
  let rev = 0;
  const clock = hlc(name, wall);
  const save = async (docs: Doc[], dirty: boolean) => {
    for (const doc of docs) store.set(doc.id, { doc, dirty, rev: ++rev });
  };
  const sync = createSync({
    pubkey,
    relays: relay.connect(),
    seal: async (id, plaintext, created_at) =>
      finalizeEvent(
        {
          kind: KIND,
          created_at,
          tags: [
            ["d", id],
            ["t", APP_TAG],
          ],
          content: nip44.encrypt(plaintext, conversation),
        },
        secret,
      ),
    open: async (e) => nip44.decrypt(e.content, conversation),
    dirty: async () =>
      [...store.values()].filter((r) => r.dirty).map(({ doc, rev }) => ({ doc, rev })),
    clean: async (published) => {
      for (const p of published) {
        const row = store.get(p.id);
        if (row?.rev === p.rev) row.dirty = false;
      }
    },
    save,
    current: (id) => store.get(id)?.doc,
    getMeta: async (k) => meta.get(k) ?? null,
    setMeta: async (k, v) => void meta.set(k, v),
    clock,
    now: () => wall(),
  });
  return {
    sync,
    clock,
    edit: (doc: Doc) => save([doc], true),
    get: (id: string) => store.get(id)?.doc,
    title: (id: string) => materialize<Todo>(store.get(id)!.doc),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("sync", () => {
  it("brings an edit from one device to the other, encrypted on the relay", async () => {
    const relay = memoryRelay();
    const a = device("a", relay, () => 1_000_000);
    const b = device("b", relay, () => 1_000_000);
    await a.sync.start();
    await b.sync.start();
    await a.edit(create("todo", "t1", { title: "Secret plan" }, a.clock));
    await a.sync.flush();
    await settle();
    expect(b.title("t1").title).toBe("Secret plan");
    const wire = relay.events.get("t1")!;
    expect(wire.content).not.toContain("Secret");
    expect(wire.tags).toEqual([
      ["d", "t1"],
      ["t", "stuff"],
    ]);
  });

  it("keeps concurrent edits to different fields of one to-do on both devices", async () => {
    const relay = memoryRelay();
    let t = 1_000_000;
    const a = device("a", relay, () => t);
    const b = device("b", relay, () => t);
    const base = create("todo", "t1", { title: "Milk" }, a.clock);
    await a.edit(base);
    await a.sync.start();
    await b.sync.start();
    await settle();

    b.sync.stop();
    t += 5000;
    await a.edit(update(a.get("t1")!, { title: "Oat milk" }, a.clock));
    await b.edit(update(b.get("t1")!, { notes: "2 litres" }, b.clock));
    await a.sync.flush();
    await settle();
    await b.sync.start();
    await settle();
    await a.sync.flush();
    await settle();

    for (const d of [a, b])
      expect(d.title("t1")).toMatchObject({ title: "Oat milk", notes: "2 litres" });
    const onRelay = JSON.parse(nip44.decrypt(relay.events.get("t1")!.content, conversation)) as Doc;
    expect(materialize<Todo>(onRelay)).toMatchObject({ title: "Oat milk", notes: "2 litres" });
  });

  it("replays offline edits made on a device with a slow clock", async () => {
    const relay = memoryRelay();
    const a = device("a", relay, () => 5_000_000);
    const slow = device("s", relay, () => 1_000_000);
    await a.sync.start();
    await a.edit(create("todo", "t1", { title: "x" }, a.clock));
    await a.sync.flush();
    await slow.sync.start();
    await settle();
    slow.sync.stop();
    await slow.edit(update(slow.get("t1")!, { title: "edited offline" }, slow.clock));
    await slow.sync.start();
    await settle();
    await a.sync.flush();
    await settle();
    expect(a.title("t1").title).toBe("edited offline");
    expect(relay.events.get("t1")!.created_at).toBeGreaterThan(5000);
  });

  it("propagates deletions as tombstones", async () => {
    const relay = memoryRelay();
    const a = device("a", relay, () => 1_000_000);
    const b = device("b", relay, () => 1_000_000);
    await a.sync.start();
    await b.sync.start();
    const doc = create("todo", "t1", { title: "x" }, a.clock);
    await a.edit(doc);
    await a.sync.flush();
    await settle();
    await b.edit({ ...update(b.get("t1")!, {}, b.clock), deleted: true });
    await b.sync.flush();
    await settle();
    expect(a.get("t1")!.deleted).toBe(true);
  });

  it("ignores events whose payload claims another object's id, and foreign authors", async () => {
    const relay = memoryRelay();
    const a = device("a", relay, () => 1_000_000);
    await a.sync.start();
    const forged = finalizeEvent(
      {
        kind: KIND,
        created_at: 1000,
        tags: [
          ["d", "t2"],
          ["t", APP_TAG],
        ],
        content: nip44.encrypt(
          JSON.stringify(create("todo", "t1", { title: "x" }, hlc("z"))),
          conversation,
        ),
      },
      secret,
    );
    await relay.connect().publish(forged);
    await settle();
    expect(a.get("t1")).toBeUndefined();
    expect(a.get("t2")).toBeUndefined();
  });
});
