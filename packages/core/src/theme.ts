/**
 * Themes: a name plus values for the CSS custom properties in packages/ui globals.css, in light
 * and dark. A theme only ever sets those properties; a value that could end a declaration, open a
 * block, load something or start an at-rule is rejected.
 */

export const COLOR_KEYS = [
  "background",
  "foreground",
  "muted-foreground",
  "sidebar",
  "sidebar-accent",
  "selected",
  "muted",
  "card",
  "popover",
  "border",
  "primary",
  "primary-foreground",
  "checkbox",
  "checkbox-border",
  "ring",
  "accent",
  "today",
  "evening",
  "inbox",
  "upcoming",
  "someday",
  "logbook",
  "deadline",
  "destructive",
] as const;

export const VAR_KEYS = [
  "font-ui",
  "font-title",
  "text-size",
  "text-meta-size",
  "text-title-size",
  "weight-body",
  "weight-heading",
  "weight-title",
  "row-height",
  "spacing",
  "sidebar-width",
  "radius",
  "checkbox-size",
  "checkbox-radius",
  "editor-shadow",
  "fab-shadow",
] as const;

export type Values = Record<string, string>;
export const DEFAULT_THEME = "Sage";

export interface Theme {
  name: string;
  /** The file a theme came from; built-ins have none. */
  file?: string;
  light: Values;
  dark: Values;
  vars: Values;
}
export type ThemeResult = { ok: true; theme: Theme } | { ok: false; error: string };

const UNSAFE = /[;{}@<>\\]|url\(/i;
const SECTIONS = { light: COLOR_KEYS, dark: COLOR_KEYS, vars: VAR_KEYS } as const;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseTheme(text: string): ThemeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (!isObject(raw)) return { ok: false, error: "Expected a JSON object." };
  if (typeof raw.name !== "string" || !raw.name.trim())
    return { ok: false, error: 'Needs a "name".' };
  const theme: Theme = { name: raw.name.trim(), light: {}, dark: {}, vars: {} };
  for (const [section, keys] of Object.entries(SECTIONS) as [
    keyof typeof SECTIONS,
    readonly string[],
  ][]) {
    const values = raw[section] ?? {};
    if (!isObject(values)) return { ok: false, error: `"${section}" must be an object.` };
    for (const key of keys) {
      const v = values[key];
      if (v === undefined) continue;
      if (typeof v !== "string" || !v.trim() || v.length > 300 || UNSAFE.test(v))
        return { ok: false, error: `${section}.${key} has an invalid value.` };
      theme[section][key] = v.trim();
    }
  }
  return { ok: true, theme };
}

export interface ThemeFile {
  file: string;
  text: string;
}

/** Built-in themes (which must parse) followed by the folder's files in file-name order. */
export function collectThemes(builtIn: string[], files: ThemeFile[]) {
  const themes: Theme[] = builtIn.map((text) => {
    const result = parseTheme(text);
    if (!result.ok) throw new Error(`Built-in theme: ${result.error}`);
    return result.theme;
  });
  const errors: { file: string; error: string }[] = [];
  for (const { file, text } of [...files].sort((a, b) => (a.file < b.file ? -1 : 1))) {
    const result = parseTheme(text);
    if (!result.ok) errors.push({ file, error: result.error });
    else if (themes.some((t) => t.name === result.theme.name))
      errors.push({ file, error: `A theme named "${result.theme.name}" already exists.` });
    else themes.push({ ...result.theme, file });
  }
  return { themes, errors };
}

/** Colours that track primary unless a theme sets them itself. */
const FOLLOWS_PRIMARY = ["checkbox", "ring"];

export function resolveTheme(theme: Theme, base: Theme): Theme {
  const colors = (own: Values, fallback: Values) => {
    const out = { ...fallback, ...own };
    if (own.primary) for (const key of FOLLOWS_PRIMARY) if (!own[key]) out[key] = own.primary;
    return out;
  };
  return {
    name: theme.name,
    light: colors(theme.light, base.light),
    dark: colors(theme.dark, base.dark),
    vars: { ...base.vars, ...theme.vars },
  };
}

function block(selector: string, values: Values) {
  const entries = Object.entries(values);
  return entries.length
    ? `${selector} {\n${entries.map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n}\n`
    : "";
}

export const themeCss = (theme: Theme) =>
  block(":root", { ...theme.light, ...theme.vars }) + block(":root.dark", theme.dark);
