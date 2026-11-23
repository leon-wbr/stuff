# stuff

A calm to-do app for the Mac. Inbox, Today and This Evening, Upcoming, Anytime, Someday, Logbook; areas, projects with headings, checklists, tags, deadlines, reminders and repeating to-dos. Everything lives on your Mac first. If you want, it syncs between your Macs over Nostr relays or through a folder in iCloud Drive, Google Drive, Dropbox or Syncthing, encrypted if you like. A `stuff` command line lets scripts and agents read and edit your to-dos.

## Using it

- **Quick Entry**: Ctrl+Space from anywhere.
- **Keyboard**: ⌘N new to-do, Space new to-do below, ⌥⌘N new project, ⇧⌘N new heading, ⌘K complete, ⌥⌘K cancel, ⌘T Today, ⌘E This Evening, ⌘R Anytime, ⌘O Someday, ⌘S When, ⇧⌘D deadline, ⇧⌘M move, ⇧⌘T tags, ⇧⌘C checklist, ⌘D duplicate, ⌘F Quick Find, ⌘1–⌘7 lists, ⌃⌘N new window, ⇧⌘S send to Things. Start typing anywhere to jump to a list or to-do (Type Travel).
- **Drag** to-dos to reorder them or onto a list in the sidebar to move them; drag the + button to put a new to-do exactly where you want it.
- **Things**: Settings → Import from Things reads a `main.sqlite` from a Things backup (read-only). "Send to Things" hands selected to-dos or a whole project to Things through its URL scheme.
- **Backup**: Settings → Backup exports and restores stuff's own JSON.

## Sync and privacy

Sync is off until you choose it in Settings → Sync, per Mac:

- **Off**: everything stays on this Mac.
- **Nostr**: set up a key (created on this Mac, or import an `nsec` to use the same key as your other Macs). The key stays in the macOS keychain; only the app's Rust side uses it. Each to-do, project, area, heading, tag, checklist item and the settings is its own Nostr event (NIP-78, kind 30078) with a random `d` tag, its content NIP-44 encrypted to your own key. Relays can see your public key, that the events belong to stuff (`t=stuff`), how many objects you have, roughly how large each is, and when each changed. They can't see titles, notes, dates, lists or tags.
- **Folder**: pick a folder that your cloud drive syncs; stuff writes one `<id>.json` file per object and reads what your other Macs write. With "Encrypt with my key" each file is the same encrypted event Nostr uses; without it, the files are plain JSON your drive's provider can read.

Edits merge per field, so editing a title on one Mac and the notes on another keeps both. The status under Sync only says "Synced" when the last changes went out and the relays or folder could be reached.

## Agents and scripts: the `stuff` CLI

`scripts/install-cli.sh` (or `pnpm install-cli`) builds the CLI and links it to `~/.local/bin/stuff`. It needs Node 22.5 or newer. It works on the same store as the app, safely while the app runs; the app shows CLI changes within a second and syncs them like its own.

Output is JSON (`{"ok":true,"result":…}`, or `{"ok":false,"error":…}` with exit code 1); add `--human` for short text. Items can be named by id, an id prefix of 6+ characters, or their exact title.

```sh
stuff commands                      # every command and its arguments, as JSON
stuff list today                    # also inbox, upcoming, anytime, someday, logbook, trash, projects, areas, tags
stuff list --project "Kitchen" --tag Errand
stuff add "Buy bulbs" --when today --project Kitchen --heading Build --tags Errand --checklist E27 --checklist dimmable
stuff add "Quarterly report" --type project --area Work --deadline 2026-12-15
stuff show 3f2a9c                   # notes, checklist, tags, project, area
stuff edit 3f2a9c --notes "Ask about dimmers" --deadline none
stuff complete 3f2a9c               # also cancel, reopen
stuff move 3f2a9c --to tomorrow     # a list, a date, or a project/area/heading
stuff delete 3f2a9c                 # to the Trash; --permanent deletes everywhere
stuff search "landlord"
stuff export > backup.json          # and: stuff import backup.json
```

`--db <path>` (or `STUFF_DB`) points it at another store; `STUFF_PROFILE` picks a profile's store like the app does.

## Extending stuff

Sync adapters, importers, exporters and commands are one small typed surface in `packages/core/src/extensions.ts`, and the built-ins use it. `docs/extensibility.md` describes it, how to write a sync adapter, and how the CLI and the app share the store.

## Development

See `CLAUDE.md` for the layout and commands; `docs/spec.md` for the data model and sync format.

```sh
pnpm install
pnpm dev
pnpm gate
pnpm e2e    # folder + CLI end to end; STUFF_E2E_RELAY=ws://… adds Nostr
```
