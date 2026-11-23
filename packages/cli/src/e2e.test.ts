/**
 * End-to-end: app-equivalent instances (the app's store, sync engine, adapters from the registry
 * and its store watcher) sync through a folder and through a Nostr relay, and the built `stuff`
 * CLI writes into a running instance's store. Opt-in: `pnpm e2e`, with `STUFF_E2E_RELAY=ws://…`
 * for the Nostr part (a throwaway `docker run --rm` nostr-rs-relay).
 */
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as nip44 from "nostr-tools/nip44";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand } from "@stuff/core/commands";
import { dayOf } from "@stuff/core/days";
import { materialize, merge, type Doc } from "@stuff/core/doc";
import { adapterFor, stuff, type SyncConfig, type SyncEnv } from "@stuff/core/extensions";
import type { FolderFs } from "@stuff/core/folder";
import { hlc } from "@stuff/core/hlc";
import { APP_TAG, KIND, type Vault } from "@stuff/core/nostr";
import { randomId } from "@stuff/core/ops";
import { relayPool } from "@stuff/core/relays";
import { createSync, type SyncStatus } from "@stuff/core/sync";
import { openStore } from "./store";

const run = process.env.STUFF_E2E ? describe : describe.skip;
const relayUrl = process.env.STUFF_E2E_RELAY;
const CLI = join(import.meta.dirname, "../dist/stuff.mjs");
const work = mkdtempSync(join(tmpdir(), "stuff-e2e-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const secret = generateSecretKey();
const pubkey = getPublicKey(secret);
const conversation = nip44.getConversationKey(secret, pubkey);
/** nostr-tools standing in for vault.rs (same format; vault.rs has a test opening its output). */
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

/** What the Rust folder commands do, with node:fs. */
const nodeFolder = (dir: string): FolderFs => ({
  list: async () =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("."))
      .map((name) => {
        const s = statSync(join(dir, name));
        return { name, mtime: s.mtimeMs, size: s.size };
      }),
  stat: async (name) => {
    try {
      const s = statSync(join(dir, name));
      return { mtime: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  },
  read: async (name) => readFileSync(join(dir, name), "utf8"),
  write: async (name, text) => {
    writeFileSync(join(dir, `.${name}.tmp`), text);
    renameSync(join(dir, `.${name}.tmp`), join(dir, name));
    const s = statSync(join(dir, name));
    return { mtime: s.mtimeMs, size: s.size };
  },
});

const env = (relays: string[]): SyncEnv => ({
  pubkey,
  vault,
  relays: () => relayPool(() => relays),
  folder: nodeFolder,
});

/** One running app: its store, documents in memory, the sync loop and the store watcher, wired like the app. */
function instance(name: string, config: SyncConfig, relays: string[] = []) {
  const store = openStore(join(work, `${name}.sqlite`));
  const docs = new Map(store.load().map((d) => [d.id, d]));
  const clock = hlc(name);
  const statuses: SyncStatus[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Every store write reaches the windows and schedules a flush, like `store-changed` in the app. */
  const remember = (saved: Doc[]) => {
    for (const d of saved) docs.set(d.id, merge(docs.get(d.id), d, clock));
    clearTimeout(timer);
    timer = setTimeout(() => void engine.flush(), 300);
  };
  const engine = createSync({
    adapter: adapterFor(stuff, config, env(relays))!,
    dirty: async () => store.dirty(),
    clean: async (p) => store.clean(p),
    save: async (ds, dirty) => remember(store.save(ds, dirty)),
    current: (id) => docs.get(id),
    all: () => docs.values(),
    getMeta: async (k) => store.meta(k),
    setMeta: async (k, v) => store.setMeta(k, v),
    clock,
    onStatus: (s) => statuses.push(s),
  });
  const watch = setInterval(() => {
    const changed = store.externalChanges();
    if (changed.length) remember(changed);
  }, 300);
  return {
    store,
    statuses,
    start: () => engine.start(),
    command(cmd: string, args: Record<string, unknown>) {
      const ctx = { docs, clock, id: randomId, now: Date.now(), today: dayOf(new Date()) };
      const { docs: changed, result } = runCommand(ctx, cmd, args);
      remember(store.save(changed, true));
      return result as { id: string };
    },
    title: (id: string) => {
      const d = docs.get(id);
      return d && (materialize(d) as { title: string; notes: string });
    },
    size: () => docs.size,
    stop() {
      clearInterval(watch);
      clearTimeout(timer);
      engine.stop();
      store.close();
    },
  };
}

async function until<T>(what: string, fn: () => T | undefined | false, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return { value: v, ms: Date.now() - start };
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const cli = (...args: string[]) =>
  JSON.parse(execFileSync("node", [CLI, ...args], { encoding: "utf8" }));

async function scenario(
  label: string,
  config: (name: string) => SyncConfig,
  relays: string[] = [],
) {
  const a = instance(`${label}-a`, config("a"), relays);
  const ids = ["Reply to the landlord", "Buy oat milk", "Plan the weekend hike"].map(
    (title) => a.command("add", { title, when: "today" }).id,
  );
  await a.start();
  const b = instance(`${label}-b`, config("b"), relays);
  const started = Date.now();
  await b.start();
  await until("B to receive A's to-dos", () => ids.every((id) => b.title(id)));
  console.log(
    `[${label}] B started empty and had A's ${ids.length} to-dos ${Date.now() - started} ms later (B holds ${b.size()} objects)`,
  );

  a.command("edit", { ref: ids[0], title: "Reply to the landlord about the boiler" });
  b.command("edit", { ref: ids[0], notes: "Call before Friday" });
  const merged = await until("both edits on both", () =>
    [a, b].every(
      (x) =>
        x.title(ids[0]!)?.title.endsWith("boiler") &&
        x.title(ids[0]!)?.notes === "Call before Friday",
    ),
  );
  console.log(`[${label}] Title edited on A and notes on B merged on both in ${merged.ms} ms`);

  const added = cli("add", "Added from the CLI", "--when", "today", "--db", a.store.path).result;
  const seenA = await until("A to see the CLI's to-do", () => a.title(added.id));
  console.log(
    `[${label}] \`stuff add\` into A's store: A's running instance had it after ${seenA.ms} ms`,
  );
  const seenB = await until("B to get the CLI's to-do", () => b.title(added.id));
  console.log(`[${label}] ... and it synced to B ${seenB.ms} ms later: "${seenB.value.title}"`);
  expect(a.statuses.at(-1)).toMatchObject({ state: "synced" });
  a.stop();
  b.stop();
  return [...ids, added.id];
}

run("end to end", () => {
  it("syncs two instances through a plain folder, with CLI writes", async () => {
    const shared = mkdtempSync(join(work, "plain-"));
    await scenario("folder", () => ({ adapter: "folder", path: shared }));
    console.log(`[folder] ${readdirSync(shared).length} files in the shared folder`);
  }, 60_000);

  it("syncs through an encrypted folder without plaintext on disk", async () => {
    const shared = mkdtempSync(join(work, "sealed-"));
    await scenario("sealed folder", () => ({ adapter: "folder", path: shared, encrypt: true }));
    const files = readdirSync(shared).map((f) => readFileSync(join(shared, f), "utf8"));
    const leaked = files.filter((t) => /landlord|boiler|oat milk|CLI/i.test(t));
    console.log(
      `[sealed folder] ${files.length} files, ${leaked.length} containing a title in plaintext`,
    );
    expect(leaked).toEqual([]);
  }, 60_000);

  it.skipIf(!relayUrl)(
    "still syncs through a Nostr relay",
    async () => {
      const ids = await scenario("nostr", () => ({ adapter: "nostr" }), [relayUrl!]);
      const pool = new SimplePool();
      const events = await pool.querySync([relayUrl!], {
        kinds: [KIND],
        authors: [pubkey],
        "#t": [APP_TAG],
      });
      pool.close([relayUrl!]);
      const leaked = events.filter((e) => /landlord|boiler|oat milk|CLI/i.test(JSON.stringify(e)));
      console.log(
        `[nostr] ${events.length} events on the relay (kinds ${[...new Set(events.map((e) => e.kind))]}, tags ${[...new Set(events.flatMap((e) => e.tags.map((t) => t[0])))]}), ${leaked.length} with plaintext`,
      );
      expect(events.map((e) => e.tags[0]![1])).toEqual(expect.arrayContaining(ids));
      expect(leaked).toEqual([]);
    },
    60_000,
  );

  it("`stuff commands --json` lists every command", () => {
    const { result } = cli("commands", "--json");
    const names = result.commands.map((c: { name: string }) => c.name);
    console.log(`[cli] stuff commands --json: ${names.join(", ")}`);
    expect(names).toEqual([...stuff.commands.keys(), "commands", "import", "export"]);
  });
});
