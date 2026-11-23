# Plan

Vertical slices, one conventional commit (or a few) each, gated with `reeve heavy -- pnpm gate` on the slice's final head, then main fast-forwarded to it.

1. **Local model + lists + editing**: scaffold (Keyhall layout), core doc/HLC/merge/order/lists, SQLite store in Rust, key setup, main window with sidebar, lists, to-do editing, projects, areas, headings, checklists, tags, drag and drop.
2. **Things import**: Rust reader, core mapping with a synthetic fixture database, import UI, verification against Leon's backup by counts.
3. **Sync**: vault (NIP-44 + signing in Rust), sync engine in core (tests with an in-memory relay), relay settings, check with two app instances on a local relay in Docker.
4. **Quick Entry and shortcuts**: global hotkey window, keymap, Quick Find / Type Travel, Magic Plus, multiple windows.
5. **Repeating and reminders**.
6. **Polish**: hand-off to Things, JSON backup, light/dark, screenshots.

## Status

Not started.
