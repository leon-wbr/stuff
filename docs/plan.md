# Plan

Vertical slices, gated with `reeve heavy -- pnpm gate` on each final head, then main fast-forwarded to it.

1. **Local model + lists + editing**: done.
2. **Things import**: done; verified against a real backup by counts (areas, open projects, Today, Inbox).
3. **Sync**: done; two instances through a local nostr-rs-relay, encrypted on the wire. Rust vault tested against nostr-tools ciphertext.
4. **Quick Entry and shortcuts**: done (Quick Entry window, keymap, Quick Find / Type Travel, Magic Plus, multiple windows).
5. **Repeating and reminders**: done in core and UI; notification delivery not yet seen natively.
6. **Polish**: hand-off to Things, JSON backup, light/dark done.
7. **Extensibility**: done. Sync adapters (Nostr, Folder; Off by default), the extension registry (commands, importers, exporters, adapters), and the `stuff` CLI over the shared store (`docs/extensibility.md`). Checked by `pnpm e2e`: two instances through a plain and an encrypted folder and a local nostr-rs-relay, with CLI writes reaching a running instance and syncing on.

Slices 1–5 landed in one commit because they were built together; later work is per slice.

## Status

Done: everything in `docs/parity.md` marked ✅.

Next:

- Check natively in the built `stuff.app`: Ctrl+Space Quick Entry, ⌃⌘N second window, reminder notifications, keychain prompt with the "Stuff Local Dev" identity (`scripts/local-signing-identity.sh`, not yet run on this Mac).
- Undo/redo; editing a repeating rule's template directly; per-tag keyboard shortcuts.
- The sync check drives two webview instances with nostr-tools standing in for `vault.rs`; a native two-app run (`STUFF_PROFILE=a` / `b`, `open -n`) is still to do.
- A third-party extension loader (plan in `docs/extensibility.md`); a passphrase mode for the folder adapter; CLI import from a Things database.
