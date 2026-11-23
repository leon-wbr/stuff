# stuff: spec

stuff is a macOS desktop to-do app for one person on several Macs. It borrows the list model and workflows of Things 3 (lists, areas, projects, headings, when vs deadline, This Evening, Logbook), stores everything locally first, and syncs between devices through a sync adapter the user picks per Mac: none (the default), Nostr with every object end-to-end encrypted to the user's own key, or a folder that a cloud drive syncs. `docs/extensibility.md` covers adapters, importers, commands and the `stuff` CLI.

## Architecture

- `apps/desktop`: Tauri 2 app. `src/` is the React UI; `src/app.ts` wires the core machine to Tauri (every `invoke`, `listen`, notification and URL call is injected there). `src-tauri/` is the Rust host: `lib.rs` (commands, windows, global shortcut), `vault.rs` (key, NIP-44 encryption and signing of sync events), `store.rs` (SQLite store, merging writes, watching for other processes' writes), `folder.rs` (the folder adapter's file access), `things.rs` (read-only reader of a Things database).
- `packages/core`: all logic as plain TS, tested with vitest. `model.ts` (object types), `hlc.ts` (hybrid logical clock), `doc.ts` (per-field LWW documents and merge), `order.ts` (fractional indexes), `lists.ts` (Inbox, Today, Upcoming, … selectors), `repeat.ts`, `reminders.ts`, `things.ts` (Things import mapping and date decoding), `thingsUrl.ts` (hand-off URL), `backup.ts`, `sync.ts` (adapter-agnostic sync engine), `nostr.ts` and `folder.ts` (sync adapters), `relays.ts` (the only module that talks to relays), `commands.ts` (named commands with typed arguments), `extensions.ts` (registry of commands, importers, exporters and sync adapters), `keys.ts` (shortcut map), `machine.ts` (XState app machine).
- `packages/cli`: the `stuff` CLI, a Node program over the same store and core commands.
- `packages/ui`: shadcn components (Base UI, Phosphor icons) and the Tailwind 4 theme, light and dark.

The key is created or imported once and kept in the macOS keychain (service `app.stuff.desktop`, account `nsec`). Only Rust reads it, through `keychain_task`; the webview asks Rust to seal (encrypt + sign) and open (verify + decrypt) sync events and can't sign anything else.

## Local store

SQLite in the Rust process (`rusqlite`, bundled), file `stuff.sqlite` in the app data dir. Chosen over IndexedDB because several windows (main windows, Quick Entry) share one store and the Rust side owns it, notifies every window of changes (`store-changed`), survives webview storage resets, and can be backed up as one file. Tables: `objects(id, doc, dirty, rev)` and `meta(key, value)` (`sync` = this Mac's adapter choice, `cursor:<adapter key>` = how far it has read). The store is WAL with a busy timeout; every write is an immediate transaction that merges each document with the stored one per field, so the CLI and the app can write concurrently. The app polls `PRAGMA data_version` and emits `store-changed` for documents other processes wrote.

The store holds documents, not rows: the webview loads all documents at start (a personal to-do list is thousands of objects, not millions), edits them in memory through `core/doc.ts` and writes changed documents back.

## Data model

Every object is a document `{ id, type, fields }` where each field is `{ v: value, c: hlc }`. `id` is a random 128-bit hex id. Types and fields:

| type        | fields                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `todo`      | title, notes (Markdown), status (`open`/`completed`/`canceled`), stopped (ms), start (`inbox`/`anytime`/`someday`), when (`YYYY-MM-DD` or null), evening, deadline, area, project, heading, index, todayIndex, tags (ids), reminder (`HH:MM`), repeat + next (on a hidden repeating template), template (on an instance), created, trashed |
| `project`   | the same minus heading, reminder, repeat                                                                                                                                                                                                                                                                                                   |
| `heading`   | title, project, index, archived, trashed                                                                                                                                                                                                                                                                                                   |
| `area`      | title, index, tags, trashed                                                                                                                                                                                                                                                                                                                |
| `tag`       | title, parent, index, shortcut                                                                                                                                                                                                                                                                                                             |
| `checklist` | title, todo, done, index                                                                                                                                                                                                                                                                                                                   |
| `settings`  | relays, theme                                                                                                                                                                                                                                                                                                                              |

Any type may carry `deleted: true` (a tombstone). `index` and `todayIndex` are fractional-index strings (`fractional-indexing`), so moving an item writes one field of one object.

## Lists

Pure selectors in `core/lists.ts`, given today's date:

- **Inbox**: open to-dos with start `inbox` (no area or project).
- **Today**: open to-dos and projects with when ≤ today, or a deadline ≤ today; those with `evening` form This Evening.
- **Upcoming**: when > today, grouped by day for the next week, then by month; repeating to-dos also show their next dates.
- **Anytime**: open, start `anytime`, when unset or ≤ today; grouped by area and project.
- **Someday**: start `someday`.
- **Logbook**: completed or canceled, newest first. Items finished today stay in their list until tomorrow, like Things.
- **Repeating**: a hidden template carries the rule and the next date; `spawnDue` creates each instance on its day with an id derived from template id + date, so two Macs create the same object. After-completion templates get their next date when the instance is completed.
- **Trash**: trashed.

## Nostr event format

The folder adapter writes the same document JSON (plain) or this same sealed event (encrypted), one `<id>.json` per object.

Each document is one NIP-78 kind 30078 parameterized replaceable event:

```json
{
  "kind": 30078,
  "tags": [
    ["d", "<object id>"],
    ["t", "stuff"]
  ],
  "content": "<NIP-44 v2 to self>"
}
```

The plaintext is the document JSON. The `d` tag is the random object id; titles, list names and types are only inside the ciphertext. `["t","stuff"]` lets the subscription skip other apps' kind 30078 data.

What still leaks to relays: the author pubkey, that it uses stuff, the number of objects, when each was last changed (`created_at`), the ciphertext length (roughly the size of each object) and which relays are used.

## Merge rules

- Per field last-writer-wins by HLC (`<ms>-<counter>-<node>`, compared as strings after zero-padding); the HLC is inside the encrypted payload, not the event's `created_at`.
- `deleted` is sticky: once a tombstone, always a tombstone.
- After merging a remote document, if the local result differs from what came in (we had newer fields), the object stays dirty and is republished, so the relay copy converges even when two devices replaced each other's event.
- An event's `created_at` is `max(now, last seen created_at for that d + 1)`, so a device with a slow clock still replaces the relay copy.
- Sync loop (any adapter): push dirty documents (debounced), watch the remote from the stored cursor, merge what arrives, store the cursor. A remote with no cursor yet gets every document once. Nostr subscribes to `{kinds:[30078], authors:[me], #t:[stuff], since: cursor - 10 min}`; Folder polls the folder every 5 s.
- Status is "synced" only when the last push succeeded and the remote answered a reachability check.

## Things interop

- **Import** reads `main.sqlite` read-only in Rust (`things.rs`, `SELECT` of the known columns) and maps rows in `core/things.ts`. Dates: `startDate` and `deadline` are packed integers (`year << 16 | month << 12 | day << 7`), `reminderTime` packs `hour << 26 | minute << 20`, `creationDate`/`stopDate` are Unix seconds. `start` 0/1/2 is Inbox/Anytime/Someday, `startBucket` 1 is This Evening, `status` 0/2/3 is open/canceled/completed, `type` 0/1/2 is to-do/project/heading. Repeating templates carry a plist rule (`fu` unit, `fa` amount, `tp` 0 fixed / 1 after completion), which becomes the repeat rule of the template's open instance. New random ids replace Things' uuids.
- **Hand-off** builds `things:///json?data=…` (Things' JSON URL scheme) for selected to-dos or a whole project, copied by Share ▸ Copy Things Link.
- **Backup** exports and imports stuff's documents as JSON.
