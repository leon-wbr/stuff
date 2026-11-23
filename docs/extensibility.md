# Extensibility, sync adapters and the CLI

stuff has four ways in from the outside: sync adapters (where your data goes), importers and exporters (how data comes in and out), commands (named edits with arguments), and themes (how it looks). The built-ins use the same surface: Nostr and Folder sync are adapters, Things import and the JSON backup are importers/exporters, and the CLI, the keyboard and the context menu dispatch commands.

Everything here rests on the data model in `docs/spec.md`: each object is a document whose fields carry an HLC stamp, and merging is per-field last-writer-wins with sticky tombstones. Merging is commutative, idempotent and order-free, so any transport that eventually delivers every document works. That's why an adapter can be small.

## Extension points

`packages/core/src/extensions.ts` defines one shape and a registry:

```ts
interface Extension {
  id: string;
  commands?: CommandDef[];
  importers?: Importer[];
  exporters?: Exporter[];
  syncAdapters?: SyncAdapterDef[];
}
```

`builtins` (in the same file) is the list of built-in extensions, and `registry(extensions)` indexes them by id, rejecting duplicates. The app, the CLI and the tests all build their registry from `builtins`.

- **Commands** (`core/commands.ts`): `{ name, summary, args, write, run(ctx, args) }`. `args` is a small typed spec (`string`, `strings`, `list`, `day`, `when`, `enum`, `ref`, `refs`, `boolean`, `number`), with one optional positional argument. `run` gets the same `Ctx` as an `Op` and returns `{ docs, result }`: write commands return changed documents (so they're ops with a name), read commands only a result. The CLI parses arguments from the spec and `stuff commands --json` prints the specs, so a new command shows up in the CLI and its help with no CLI change. Shortcuts and context menus dispatch op-backed commands by name: `commandOp("complete", { refs: ids, toggle: true })` is an `Op` (⌘K uses it; ⌘T/⌘E/⌘R/⌘O use `move` and Delete uses `delete`).
- **Importers** (`{ id, title, input, op(input) }`): `input` names what the host must supply (`"text"` for a file's text, `"things"` for the rows `things.rs` reads). The op merges, so importing twice or restoring an old backup never loses newer edits. Built-ins: `json` (stuff backup) and `things`.
- **Exporters** (`{ id, title, run(docs) → string }`). Built-in: `json`.
- **Sync adapters**: below.
- **Themes**: JSON files in a themes folder, loaded by their own module; see `docs/themes.md`. They don't go through the registry because they're data, not code.

### Third-party extensions (not built)

A loader would only have to produce more `Extension` values; nothing else changes. The plan when it's wanted: extensions are ES modules in `~/Library/Application Support/app.stuff.desktop/extensions/<id>/index.js` exporting `default: Extension`, listed and enabled per Mac in Settings. The app imports them in the webview through a custom `stuff-ext://` protocol; the CLI with a dynamic `import()`. Commands and importers are pure functions over documents, so they need no extra permissions; a sync adapter needs network or file access, which the host would grant per extension (the webview's CSP and Tauri capabilities are the gate). It isn't built yet because untrusted code in the webview can read every document, and the permission story deserves its own design.

## Sync adapters

```ts
interface SyncAdapter {
  /** Stable per remote, e.g. `nostr:<pubkey>` or `folder:<path>`. The engine keeps one cursor per key. */
  key: string;
  /** Reads everything after `cursor`, calls `ready` once caught up, then keeps delivering changes until stopped. */
  watch(
    cursor: string | null,
    on: {
      changes(docs: Doc[], cursor: string): Promise<void>;
      ready(): void;
      error(e: unknown): void;
    },
  ): () => void;
  /** Stores one document remotely. */
  push(doc: Doc): Promise<void>;
  /** Throws with a readable message if the remote can't be reached right now. */
  check(): Promise<void>;
}
```

The engine (`core/sync.ts`) is adapter-agnostic: it publishes dirty documents through `push`, merges what `watch` delivers (re-marking a document dirty when the merged result is newer than what arrived, so the remote converges), stores the cursor in the store's `meta` table under `cursor:<key>`, and reports status. When an adapter starts with no cursor (a new remote), the engine pushes every document once, so switching from Nostr to a folder carries everything over.

Cursors are opaque strings owned by the adapter. Nostr's is the newest `created_at` seen; Folder's is a map of file name to modification time and size.

**Honest status.** The engine reports `synced` only after a flush whose pushes all succeeded and whose `check()` passed; otherwise `offline` with the adapter's message ("No relay is reachable", "The folder … doesn't exist"). The UI shows that text.

### Nostr

Today's behaviour, moved behind the interface unchanged: one kind 30078 event per document, `d` = object id, `t=stuff`, NIP-44 to self, `created_at` above the last one seen for that `d`, subscription since the cursor minus ten minutes. The key stays in the keychain and `vault.rs` seals and opens; the adapter gets `seal`/`open` injected. `check()` asks the relay pool to connect to each enabled relay (5 s timeout) and fails if none answers.

### Folder

One file per object, `<folder>/<id>.json`, written atomically (temporary dot-file, then rename). Pointing it at a folder inside Google Drive, iCloud Drive, Dropbox or a Syncthing share syncs through that service's desktop client; stuff never talks to the service. The adapter polls the folder (default every 5 s; file events are unreliable on cloud drives) and reads files whose modification time or size changed since the cursor. File names other than `<id>.json` (a cloud client's "conflicted copy") are read too and merged by the id inside, so a conflict can't lose an edit.

Encryption is optional: with "Encrypt with my key" each file is the same sealed event Nostr uses (NIP-44 to self, signed), produced by `vault.rs`. Plain files are the document JSON. The reader accepts both, so turning encryption on rewrites files as they change.

### Settings

Settings → Sync offers Off (this Mac only), Nostr, and Folder… Off is the default; a fresh install shows no key prompt. Choosing Nostr shows key setup and relays; Folder shows a folder picker and the encryption switch (which needs the key). The choice is per Mac, stored in the store's `meta` table (`sync` = `{"adapter":"off"|"nostr"|"folder","path"?,"encrypt"?}`), not in the synced settings document, because a folder path belongs to one Mac.

### Writing another adapter

Implement the four members over any blob store: S3 (`key` = bucket/prefix, `push` = PUT `<id>`, cursor = last listing time), WebDAV, a git repo. Encryption is the adapter's choice; `vault.rs`'s seal/open is available to any of them. Register it as a `SyncAdapterDef` (`{ id, title, create(config, env) }`).

## CLI

`stuff` is a Node program in `packages/cli`, bundled to one file (`dist/stuff.mjs`) and linked into `~/.local/bin` by `scripts/install-cli.sh`.

**Why Node, not Rust.** Every write must go through the same core ops and HLC as the app, and the lists (Today, Upcoming, …), search and placement rules are all TypeScript in `packages/core`. A Rust CLI would have to reimplement them and would drift. Node 22.5+ has `node:sqlite` built in, so the CLI needs no native module; agents' machines nearly always have Node. The cost is a Node dependency for CLI users; the app itself doesn't need Node.

**Shape.** `stuff <command> [positional] [--arg value]…`. Output is JSON by default (one object per call, `{ ok: true, result }` or `{ ok: false, error }` with exit code 1); `--human` prints short text. References (`--project`, ids) take an id, an id prefix of 6+ characters, or an exact title (case-insensitive); ambiguity is an error listing the candidates.

| command                                                                                  | does                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list <today\|inbox\|upcoming\|anytime\|someday\|logbook\|trash\|projects\|areas\|tags>` | items in a list, by section; `--project`, `--area`, `--tag`, `--query` filter                                                                                                                                           |
| `show <ref>`                                                                             | one item with notes, checklist, tags, project and area                                                                                                                                                                  |
| `search <query>`                                                                         | Quick Find                                                                                                                                                                                                              |
| `add <title>`                                                                            | `--type todo\|project\|area\|heading\|tag`, `--notes`, `--when` (today, evening, tomorrow, anytime, someday, inbox, YYYY-MM-DD), `--deadline`, `--tags`, `--project`, `--heading`, `--area`, `--checklist` (repeatable) |
| `edit <ref>`                                                                             | the same fields; `--deadline none` clears                                                                                                                                                                               |
| `complete`, `cancel`, `reopen <ref…>`                                                    | status                                                                                                                                                                                                                  |
| `move <ref…> --to <list or project/area/heading>`                                        | like dropping on the sidebar                                                                                                                                                                                            |
| `delete <ref…>`                                                                          | to the Trash; `--permanent` tombstones                                                                                                                                                                                  |
| `import <file>` / `export`                                                               | through the registered importers/exporters (JSON backup)                                                                                                                                                                |
| `commands`                                                                               | every command with its arguments, as JSON                                                                                                                                                                               |

The store is found the way the app finds it (`~/Library/Application Support/app.stuff.desktop/[<STUFF_PROFILE>/]stuff.sqlite`); `--db` or `STUFF_DB` override it.

## Sharing the store with a running app

- **WAL and busy timeout.** Both the app and the CLI open `stuff.sqlite` in WAL mode with a 5 s busy timeout, so readers never block and writers wait for each other instead of failing.
- **Writes are transactions that merge.** Every save (Rust `store.rs` and the CLI) runs in a `BEGIN IMMEDIATE` transaction and merges each incoming document with the row already there, per field by HLC. Two writers that each hold a slightly stale copy (the app's in-memory documents, a CLI that loaded a moment ago, two windows) can't overwrite each other's newer fields.
- **Same ops and clock.** The CLI loads the documents inside its transaction, observes every stamp so its HLC is ahead of them, runs the command's op, and writes the changed documents with the dirty flag, exactly like an edit in the app. The running app then syncs them; if no app is running they go out the next time one starts.
- **The app notices.** The Rust store polls `PRAGMA data_version` every 300 ms (it only changes when another connection commits). On a change it reads the rows whose revision is newer than the last one it saw and emits `store-changed` to every window; the windows merge them and the sync loop flushes. A CLI write reaches the app's UI within about half a second and the sync adapter right after.

## Decisions (overrule any of these)

1. **CLI in Node, bundled, on `packages/core`**, not a Rust binary. Requires Node 22.5+.
2. **Folder adapter encrypts with the stuff key (the same sealed events as Nostr), not a passphrase.** One crypto path, one key in the keychain; a passphrase mode would add key derivation and a second secret to manage. Encryption is off by default for folders.
3. **Sync choice is per Mac** (store `meta`), default Off. Relays stay in the synced settings document.
4. **Switching to a new remote pushes everything once**; the old remote is left as it was.
5. **Folder adapter polls every 5 s** instead of using file events.
6. **The store merges on every write** (Rust and CLI), instead of last-write-wins per row.
7. **The app notices external writes by polling `data_version`** (300 ms), not a socket or file watcher: no extra process, works with any writer.
8. **CLI `delete` moves to the Trash**; `--permanent` tombstones.
9. **CLI references accept id, 6+ character id prefix or exact title.** Unknown tag names are an error rather than created silently.
10. **No third-party plugin loader yet**; the `Extension` shape and the loader plan above are where it slots in.
11. **The CLI doesn't sync by itself.** It writes the store; the app syncs.
