# Themes

A theme is a JSON file that sets stuff's colours, fonts, sizes and shadows. stuff ships seven (Sage, the default, plus Original, Calm Blue, High Contrast, Paper & Ink, Graphite and Persimmon, in `packages/ui/themes/`), and you add your own by dropping a file into the themes folder:

```
~/Library/Application Support/app.stuff.desktop/themes/
```

(With `STUFF_PROFILE=name` it's `…/app.stuff.desktop/name/themes/`.) Settings → Appearance lists the built-ins and every valid file there, and its "themes folder" link reveals it in Finder. Light, dark or system stays a separate choice. The chosen theme's name syncs like any other setting; a Mac without that file shows Sage.

## The file

```json
{
  "$schema": "./theme.schema.json",
  "name": "Dusk",
  "light": { "background": "#f6f1fb", "primary": "#7a3fb0" },
  "dark": { "background": "#1c1a20", "primary": "#b996e0" },
  "vars": { "row-height": "34px", "checkbox-radius": "50%" }
}
```

- `name` is required and must not repeat another theme's name.
- `light` and `dark` hold colours, `vars` the fonts, type sizes and weights, row height, spacing, sidebar width, radius, checkbox size and shape, and shadows. `theme.schema.json`, which stuff writes into the folder on launch, lists every key with a description, so an editor that reads `$schema` completes and checks them.
- Leave a key out and it falls back to Sage. If you set `primary` but not `checkbox` or `ring`, those follow your `primary`. Unknown keys are ignored.
- Each value becomes one CSS custom property and nothing else. A value containing `;`, `{`, `}`, `@`, `<`, `>`, `\` or `url(` makes the file invalid.

stuff re-reads the folder within a second of a change, so saving a file updates every window. An invalid file is skipped and Settings names it with a short reason.

The quickest way to make one is the design playground (`pnpm design`): pick a preset, tweak it, and "Copy settings" gives you a theme file to save into the folder.

## How it's built

- `packages/core/src/theme.ts` is the whole loader: `parseTheme` (validation and the key allow-list), `collectThemes` (built-ins first, then folder files in name order, with errors), `resolveTheme` (fallback to the default) and `themeCss`. It knows nothing about Tauri or the DOM.
- `packages/ui/themes/` holds the built-in files and the JSON Schema; `packages/ui/src/styles/globals.css` holds Sage, and a test keeps the two equal.
- `apps/desktop/src-tauri/src/themes.rs` creates the folder, writes the schema, reads `*.json` (up to 256 KB) and polls for changes, emitting `themes-changed`; the `themes_load` command returns `{dir, files}`.
- `apps/desktop/src/themes.ts` keeps each window's list and applies the chosen theme as one `<style>` element; Sage applies nothing, since it's `globals.css` itself.

As an extension kind, a theme is a folder name (`themes`), a file pattern (`*.json`), a parser (`parseTheme`) and an effect (set CSS custom properties). Registering it with the extension surface means handing those four to it; the Rust folder code is generic apart from the schema it writes.
