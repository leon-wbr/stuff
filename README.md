# stuff

A calm to-do app for the Mac. Inbox, Today and This Evening, Upcoming, Anytime, Someday, Logbook; areas, projects with headings, checklists, tags, deadlines, reminders and repeating to-dos. Everything lives on your Mac first and syncs between your Macs over Nostr relays, encrypted so the relays never see what your to-dos say.

## Using it

- **Quick Entry**: Ctrl+Space from anywhere.
- **Keyboard**: ⌘N new to-do, Space new to-do below, ⌥⌘N new project, ⇧⌘N new heading, ⌘K complete, ⌥⌘K cancel, ⌘T Today, ⌘E This Evening, ⌘R Anytime, ⌘O Someday, ⌘S When, ⇧⌘D deadline, ⇧⌘M move, ⇧⌘T tags, ⇧⌘C checklist, ⇧⌘R repeat, ⌘D duplicate, ⌘Z undo, ⇧⌘Z redo, ⌃⌘S hide the sidebar, ⌘F Quick Find, ⌘1–⌘7 lists, ⌃⌘N new window, ⇧⌘S send to Things. Start typing anywhere to jump to a list or to-do (Type Travel).
- **Right-click** anything (to-dos, a selection, projects, areas, headings, sidebar lists) for its actions; each shows its shortcut.
- **Drag** to-dos to reorder them or onto a list in the sidebar to move them; drag the + button to put a new to-do exactly where you want it.
- **Things**: Settings → Import from Things reads a `main.sqlite` from a Things backup (read-only). "Send to Things" hands selected to-dos or a whole project to Things through its URL scheme.
- **Backup**: Settings → Backup exports and restores stuff's own JSON.

## Sync and privacy

Set up a key in Settings (created on this Mac, or import an `nsec` to use the same key as your other Macs). The key stays in the macOS keychain; only the app's Rust side uses it.

Each to-do, project, area, heading, tag, checklist item and the settings is its own Nostr event (NIP-78, kind 30078) with a random `d` tag, its content NIP-44 encrypted to your own key. Relays can see your public key, that the events belong to stuff (`t=stuff`), how many objects you have, roughly how large each is, and when each changed. They can't see titles, notes, dates, lists or tags. Edits merge per field, so editing a title on one Mac and the notes on another keeps both.

## Development

See `CLAUDE.md` for the layout and commands; `docs/spec.md` for the data model and sync format.

```sh
pnpm install
pnpm dev
pnpm gate
```
