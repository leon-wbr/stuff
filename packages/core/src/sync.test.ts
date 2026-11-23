import { matchFilter, type Filter } from "nostr-tools/filter";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { create, materialize, update, type Doc } from "./doc";
import { folderAdapter, type FolderFs } from "./folder";
import { hlc } from "./hlc";
import type { Todo } from "./model";
import { APP_TAG, KIND, nostrAdapter, type Relays, type Vault } from "./nostr";
import { createSync, type SyncAdapter, type SyncStatus } from "./sync";

/** A relay keeping the newest event per `d`, like a real one does for kind 30078. */
function memoryRelay() {
  const events = new Map<string, Event>();
  const subs = new Set<{ filter: Filter; onEvent(e: Event): void }>();
  let reachable = true;
  return {
    events,
    down: () => void (reachable = false),
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
          if (!reachable) throw new Error("No relay accepted the update");
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
        async check() {
          if (!reachable) throw new Error("No relay is reachable");
        },
      };
    },
  };
}

/** A shared folder; each device sees it through its own handle, the way a cloud drive client does. */
function memoryFolder() {
  const files = new Map<string, { text: string; mtime: number }>();
  let tick = 0;
  const stat = (name: string) => {
    const f = files.get(name);
    return f && { mtime: f.mtime, size: f.text.length };
  };
  const fs: FolderFs = {
    list: async () => [...files.keys()].map((name) => ({ name, ...stat(name)! })),
    stat: async (name) => stat(name) ?? null,
    read: async (name) => files.get(name)!.text,
    write: async (name, text) => {
      files.set(name, { text, mtime: ++tick });
      return stat(name)!;
    },
  };
  return { files, fs };
}

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const conversation = nip44.getConversationKey(secret, pubkey);
const vault: Vault = {
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
};

function device(name: string, adapter: SyncAdapter, wall: () => number) {
  const store = new Map<string, { doc: Doc; dirty: boolean; rev: number }>();
  const meta = new Map<string, string>();
  const statuses: SyncStatus[] = [];
  let rev = 0;
  const clock = hlc(name, wall);
  const save = async (docs: Doc[], dirty: boolean) => {
    for (const doc of docs) store.set(doc.id, { doc, dirty, rev: ++rev });
  };
  const sync = createSync({
    adapter,
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
    all: () => [...store.values()].map((r) => r.doc),
    getMeta: async (k) => meta.get(k) ?? null,
    setMeta: async (k, v) => void meta.set(k, v),
    clock,
    onStatus: (s) => statuses.push(s),
  });
  return {
    sync,
    clock,
    statuses,
    edit: (doc: Doc) => save([doc], true),
    /** Writes without marking dirty, like documents that were already synced elsewhere. */
    seed: (doc: Doc) => save([doc], false),
    get: (id: string) => store.get(id)?.doc,
    title: (id: string) => materialize<Todo>(store.get(id)!.doc),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** The same behaviour through every adapter. */
const remotes = {
  nostr: () => {
    const relay = memoryRelay();
    return (wall: () => number) =>
      nostrAdapter({ pubkey, relays: relay.connect(), vault, now: wall });
  },
  folder: () => {
    const { fs } = memoryFolder();
    return () => folderAdapter({ path: "/shared", fs, interval: 1 });
  },
  "encrypted folder": () => {
    const { fs } = memoryFolder();
    return () => folderAdapter({ path: "/shared", fs, vault, encrypt: true, interval: 1 });
  },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.each(Object.entries(remotes))("sync through %s", (_, remote) => {
  it("brings an edit from one device to the other", async () => {
    const connect = remote();
    const a = device(
      "a",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    const b = device(
      "b",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    await a.sync.start();
    await b.sync.start();
    await a.edit(create("todo", "t1", { title: "Secret plan" }, a.clock));
    await a.sync.flush();
    await wait(10);
    expect(b.title("t1").title).toBe("Secret plan");
    expect(a.statuses.at(-1)).toMatchObject({ state: "synced" });
    a.sync.stop();
    b.sync.stop();
  });

  it("keeps concurrent edits to different fields of one to-do on both devices", async () => {
    const connect = remote();
    let t = 1_000_000;
    const a = device(
      "a",
      connect(() => t),
      () => t,
    );
    const b = device(
      "b",
      connect(() => t),
      () => t,
    );
    await a.edit(create("todo", "t1", { title: "Milk" }, a.clock));
    await a.sync.start();
    await b.sync.start();
    await wait(10);

    b.sync.stop();
    t += 5000;
    await a.edit(update(a.get("t1")!, { title: "Oat milk" }, a.clock));
    await b.edit(update(b.get("t1")!, { notes: "2 litres" }, b.clock));
    await a.sync.flush();
    await b.sync.start();
    await wait(10);
    await a.sync.flush();
    await wait(10);

    for (const d of [a, b])
      expect(d.title("t1")).toMatchObject({ title: "Oat milk", notes: "2 litres" });
    a.sync.stop();
    b.sync.stop();
  });

  it("propagates deletions as tombstones", async () => {
    const connect = remote();
    const a = device(
      "a",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    const b = device(
      "b",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    await a.sync.start();
    await b.sync.start();
    await a.edit(create("todo", "t1", { title: "x" }, a.clock));
    await a.sync.flush();
    await wait(10);
    await b.edit({ ...update(b.get("t1")!, {}, b.clock), deleted: true });
    await b.sync.flush();
    await wait(10);
    expect(a.get("t1")!.deleted).toBe(true);
    a.sync.stop();
    b.sync.stop();
  });

  it("pushes every document once to a remote it hasn't synced with", async () => {
    const connect = remote();
    const a = device(
      "a",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    await a.seed(create("todo", "old", { title: "Already synced elsewhere" }, a.clock));
    await a.sync.start();
    const b = device(
      "b",
      connect(() => 1_000_000),
      () => 1_000_000,
    );
    await b.sync.start();
    await wait(10);
    expect(b.title("old").title).toBe("Already synced elsewhere");
    a.sync.stop();
    b.sync.stop();
  });
});

describe("nostr adapter", () => {
  it("encrypts on the relay and tags only the id and the app", async () => {
    const relay = memoryRelay();
    const a = device("a", nostrAdapter({ pubkey, relays: relay.connect(), vault }), Date.now);
    await a.sync.start();
    await a.edit(create("todo", "t1", { title: "Secret plan" }, a.clock));
    await a.sync.flush();
    const wire = relay.events.get("t1")!;
    expect(wire.content).not.toContain("Secret");
    expect(wire.tags).toEqual([
      ["d", "t1"],
      ["t", "stuff"],
    ]);
  });

  it("replays offline edits made on a device with a slow clock", async () => {
    const relay = memoryRelay();
    const fast = () => 5_000_000;
    const slowWall = () => 1_000_000;
    const a = device(
      "a",
      nostrAdapter({ pubkey, relays: relay.connect(), vault, now: fast }),
      fast,
    );
    const slowAdapter = nostrAdapter({ pubkey, relays: relay.connect(), vault, now: slowWall });
    const slow = device("s", slowAdapter, slowWall);
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

  it("ignores events whose payload claims another object's id", async () => {
    const relay = memoryRelay();
    const a = device("a", nostrAdapter({ pubkey, relays: relay.connect(), vault }), Date.now);
    await a.sync.start();
    const plaintext = JSON.stringify(create("todo", "t1", { title: "x" }, hlc("z")));
    await relay.connect().publish(await vault.seal("t2", plaintext, 1000));
    await settle();
    expect(a.get("t1")).toBeUndefined();
    expect(a.get("t2")).toBeUndefined();
  });

  it("doesn't claim to be synced when no relay is reachable", async () => {
    const relay = memoryRelay();
    const a = device("a", nostrAdapter({ pubkey, relays: relay.connect(), vault }), Date.now);
    await a.sync.start();
    relay.down();
    await a.sync.flush();
    expect(a.statuses.at(-1)).toEqual({ state: "error", error: "No relay is reachable" });
  });
});

describe("folder adapter", () => {
  it("writes one plain JSON file per object, or a sealed event when encrypting", async () => {
    const plain = memoryFolder();
    const a = device("a", folderAdapter({ path: "/p", fs: plain.fs }), Date.now);
    await a.sync.start();
    await a.edit(create("todo", "t1", { title: "Secret plan" }, a.clock));
    await a.sync.flush();
    expect(JSON.parse(plain.files.get("t1.json")!.text)).toEqual(a.get("t1"));
    a.sync.stop();

    const sealed = memoryFolder();
    const b = device(
      "b",
      folderAdapter({ path: "/s", fs: sealed.fs, vault, encrypt: true }),
      Date.now,
    );
    await b.sync.start();
    await b.edit(create("todo", "t1", { title: "Secret plan" }, b.clock));
    await b.sync.flush();
    const text = sealed.files.get("t1.json")!.text;
    expect(text).not.toContain("Secret");
    expect(JSON.parse(text)).toMatchObject({ kind: KIND, pubkey });
    b.sync.stop();
  });

  it("merges a conflicted copy a cloud drive left next to the file", async () => {
    const { files, fs } = memoryFolder();
    const a = device("a", folderAdapter({ path: "/p", fs, interval: 1 }), () => 1_000_000);
    const clock = hlc("z", () => 2_000_000);
    const base = create("todo", "t1", { title: "Milk" }, clock);
    files.set("t1.json", { text: JSON.stringify(base), mtime: 1 });
    files.set("t1 (conflicted copy).json", {
      text: JSON.stringify(update(base, { notes: "2 litres" }, clock)),
      mtime: 2,
    });
    await a.sync.start();
    await wait(5);
    expect(a.title("t1")).toMatchObject({ title: "Milk", notes: "2 litres" });
    a.sync.stop();
  });

  it("merges a file that changed since the last read instead of overwriting it", async () => {
    const { files, fs } = memoryFolder();
    const a = device("a", folderAdapter({ path: "/p", fs, interval: 60_000 }), () => 1_000_000);
    await a.edit(create("todo", "t1", { title: "Milk" }, a.clock));
    await a.sync.start();
    const theirs = update(
      JSON.parse(files.get("t1.json")!.text) as Doc,
      { notes: "from the other Mac" },
      hlc("z", () => 2_000_000),
    );
    files.set("t1.json", { text: JSON.stringify(theirs), mtime: 99 });
    await a.edit(update(a.get("t1")!, { title: "Oat milk" }, a.clock));
    await a.sync.flush();
    const onDisk = materialize<Todo>(JSON.parse(files.get("t1.json")!.text) as Doc);
    expect(onDisk).toMatchObject({ title: "Oat milk", notes: "from the other Mac" });
    a.sync.stop();
  });

  it("reports a missing folder", async () => {
    const fs: FolderFs = {
      list: async () => {
        throw new Error("The folder /gone doesn't exist");
      },
      stat: async () => null,
      read: async () => "",
      write: async () => ({ mtime: 0, size: 0 }),
    };
    const a = device("a", folderAdapter({ path: "/gone", fs }), Date.now);
    await a.sync.start();
    expect(a.statuses.at(-1)).toEqual({ state: "error", error: "The folder /gone doesn't exist" });
    a.sync.stop();
  });
});
