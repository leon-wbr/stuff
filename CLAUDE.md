# stuff

A macOS to-do app in the spirit of Things 3: local-first, synced between Macs over Nostr with every object end-to-end encrypted to the user's own key, with import from and hand-off to Things. `docs/spec.md` is the design (data model, event format, merge rules), `docs/plan.md` what's done and next, `docs/parity.md` the feature checklist against Things.

## Layout

- `apps/desktop`: Tauri 2 app. `src/` is the React UI; `src/app.ts` wires the core machine to Tauri (every `invoke` and `listen` is injected there). One file per view: `Sidebar`, `ListView`, `Row`, `Editor`, `pickers`, `QuickFind`, `QuickEntry`, `Settings`, `DataSettings`. `sync.ts` runs the sync loop, `useShortcuts.ts` the keyboard, `useReminders.ts` notifications.
- `apps/desktop/src-tauri`: Rust host. `lib.rs` holds commands, windows (main windows `main`, `main-N`; Quick Entry `quick`) and the Ctrl+Space global shortcut; `vault.rs` seals (NIP-44 encrypt to self + sign kind 30078) and opens sync events; `store.rs` is the SQLite store; `things.rs` reads a Things database read-only.
- `packages/core`: all logic as plain TS, exported raw (`@stuff/core/<file>`). `doc.ts` (per-field LWW documents), `hlc.ts`, `lists.ts` (Inbox, Today, … selectors), `ops.ts` (edits as `Op`s returning changed documents), `repeat.ts`, `reminders.ts`, `things.ts` (import), `thingsUrl.ts` (hand-off), `backup.ts`, `sync.ts` (sync engine), `relays.ts` (the only module that talks to relays), `keys.ts` (shortcut map), `search.ts` (Quick Find), `machine.ts` (XState app machine).
- `packages/ui`: shadcn components (Base UI, Phosphor icons) and the Tailwind 4 theme, light and dark (`.dark` on `<html>`). The default theme, Sage, is `globals.css`; `themes/` holds the built-in theme files and their JSON Schema, and users add theme files to a folder (`docs/themes.md`, loader in `core/theme.ts`). Colours, fonts, type sizes, row height, sidebar width, checkbox shape and shadows are CSS variables in `globals.css`; use their utilities (`text-ui`, `text-meta`, `text-title`, `font-display`, `min-h-(--row-height)`, `text-inbox`, …) rather than literal values.
- `apps/playground`: the design playground. It renders the real desktop `App` in iframes (Tauri IPC stubbed in `tauri.ts`, synthetic data from `seed.ts`) next to a panel that edits the theme variables live; `tokens.ts` mirrors the variables in `globals.css` and `presets.ts` holds the named presets. Builds to one self-contained `index.html` that works from file://.

## Architecture

- **Documents.** Every object is `{id, type, f: {field: {v, c}}}` with an HLC stamp per field; merge is per-field last-writer-wins, `deleted` is a sticky tombstone. Edits are `Op`s from `core/ops.ts`; the machine applies them, and `store_save` writes them (dirty) and emits `store-changed` to every window, which merge it in.
- **Sync** (primary window only): publish dirty documents sealed by Rust, subscribe to `kind 30078, authors [me], #t [stuff]` since the last sync, merge, and republish when the merged result is newer than what arrived.
- **Key.** Keychain service `app.stuff.desktop`, account `nsec`. Only Rust reads it, through `keychain_task`. `STUFF_PROFILE=name` gives an instance its own store and keychain account (`nsec-name`) for local sync tests.

## Commands

```sh
pnpm install
pnpm dev          # tauri dev (Vite on :1430, strict port)
pnpm test         # vitest via turbo (packages/core, apps/playground)
pnpm check-types  # tsc (TypeScript 7) via turbo
pnpm lint         # oxlint --deny-warnings
pnpm fmt          # oxfmt; fmt:check to verify
pnpm build        # tauri build → stuff.app
pnpm design       # design playground → ~/work/reports/stuff/design/index.html (DESIGN_OUT to override)
pnpm gate         # lint, fmt:check, check-types, test, cargo test, build
```

## House rules

- **Gate locally** (leon-wbr Actions are off): `reeve heavy -- pnpm gate` once per final head.
- **Lint and format** with oxlint and oxfmt only.
- **TDD in `packages/core`.** Keep relay, Tauri and storage access injected. Things fixtures are synthetic (`things.fixture.ts` builds one with `node:sqlite`); never commit a real Things database, its contents or screenshots of it.
- **UI verification**: the Vite app in headless Chromium with Tauri IPC mocked and synthetic data; screenshots to `~/work/reports/stuff/`, not the repo.
- **Local macOS signing**: `scripts/local-signing-identity.sh` creates "Stuff Local Dev" once; `pnpm build` signs with it so keychain trust survives rebuilds.
- Never publish to real relays with a real key in tests; use a local relay (`docker run --rm`) and generated keys.

## Gotchas

- **A new theme variable** goes in `globals.css` (`:root`, `.dark` if it differs, and `@theme inline` for a utility), in `COLOR_KEYS`/`VAR_KEYS` in `core/theme.ts`, in every file in `packages/ui/themes/` and the schema, and a control in `apps/playground/src/tokens.ts`; the tests point at whatever is missing.
- **A new Tauri command needs three edits:** `src-tauri/build.rs`, `generate_handler!` in `lib.rs`, and `allow-<command>` in `capabilities/main.json`.
- Store writes always emit `store-changed`, including to the window that wrote; merging is idempotent, so that's fine.
- Fractional indexes compare with `<`, never `localeCompare`.
- `dist/`, `src-tauri/gen/` and `permissions/autogenerated/` are generated and ignored.
