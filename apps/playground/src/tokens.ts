import { themeCss as coreThemeCss } from "@stuff/core/theme";
import { BUILT_IN_THEMES } from "@stuff/ui/themes";

/** The design tokens the playground can tweak, mirroring packages/ui/src/styles/globals.css. */

export type Mode = "light" | "dark";
export type Colors = Record<string, string>;
export interface Theme {
  light: Colors;
  dark: Colors;
  vars: Record<string, string>;
}

export interface ColorControl {
  key: string;
  label: string;
  group: string;
}

export type VarControl = { key: string; label: string; group: string } & (
  | { kind: "range"; min: number; max: number; step: number; unit: string }
  | { kind: "select"; options: { label: string; value: string }[] }
);

const color = (group: string) => (key: string, label: string) => ({ key, label, group });
const surface = color("Surfaces");
const accent = color("Accent & controls");
const signal = color("Lists & signals");

export const COLORS: ColorControl[] = [
  surface("background", "Background"),
  surface("foreground", "Text"),
  surface("muted-foreground", "Secondary text"),
  surface("sidebar", "Sidebar"),
  surface("sidebar-accent", "Sidebar selection"),
  surface("selected", "Selected row"),
  surface("muted", "Muted fill (hover, chips)"),
  surface("card", "Editor card"),
  surface("popover", "Popovers"),
  surface("border", "Borders"),
  accent("primary", "Primary / brand"),
  accent("primary-foreground", "Text on primary"),
  accent("checkbox", "Checkbox (checked)"),
  accent("checkbox-border", "Checkbox outline"),
  accent("ring", "Focus ring"),
  accent("accent", "Menu hover"),
  signal("today", "Today star"),
  signal("evening", "Evening moon"),
  signal("inbox", "Inbox"),
  signal("upcoming", "Upcoming"),
  signal("someday", "Someday"),
  signal("logbook", "Logbook"),
  signal("deadline", "Deadline"),
  signal("destructive", "Destructive"),
];

export const FONTS = [
  {
    label: "System (SF Pro)",
    value: '-apple-system, BlinkMacSystemFont, "Inter", ui-sans-serif, sans-serif',
  },
  { label: "SF Pro Rounded", value: 'ui-rounded, "SF Pro Rounded", -apple-system, sans-serif' },
  { label: "New York (serif)", value: 'ui-serif, "New York", Georgia, serif' },
  { label: "Avenir Next", value: '"Avenir Next", Avenir, -apple-system, sans-serif' },
  { label: "Helvetica Neue", value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: "Inter", value: '"Inter", "Inter Variable", -apple-system, sans-serif' },
  { label: "SF Mono", value: 'ui-monospace, "SF Mono", Menlo, monospace' },
];

const px = (key: string, label: string, group: string, min: number, max: number, step = 1) =>
  ({ key, label, group, kind: "range", min, max, step, unit: "px" }) as const;
const weight = (key: string, label: string) =>
  ({
    key,
    label,
    group: "Typography",
    kind: "range",
    min: 300,
    max: 800,
    step: 50,
    unit: "",
  }) as const;
const border = "0 0 0 1px var(--border)";

export const VARS: VarControl[] = [
  { key: "font-ui", label: "UI font", group: "Typography", kind: "select", options: FONTS },
  {
    key: "font-title",
    label: "List title font",
    group: "Typography",
    kind: "select",
    options: [{ label: "Same as UI", value: "var(--font-ui)" }, ...FONTS],
  },
  px("text-size", "Body size", "Typography", 11, 16, 0.5),
  px("text-meta-size", "Meta size (tags, dates)", "Typography", 9, 14, 0.5),
  px("text-title-size", "List title size", "Typography", 16, 36),
  weight("weight-body", "Body weight"),
  weight("weight-heading", "Heading weight"),
  weight("weight-title", "Title weight"),
  px("row-height", "Row height", "Layout & density", 22, 40),
  px("spacing", "Spacing scale (all paddings & gaps)", "Layout & density", 3, 5.5, 0.25),
  px("sidebar-width", "Sidebar width", "Layout & density", 180, 320, 4),
  px("radius", "Corner radius", "Layout & density", 0, 16),
  px("checkbox-size", "Checkbox size", "Checkbox", 12, 20),
  {
    key: "checkbox-radius",
    label: "Checkbox shape",
    group: "Checkbox",
    kind: "select",
    options: [
      { label: "Square", value: "1px" },
      { label: "Rounded", value: "4px" },
      { label: "Soft", value: "6px" },
      { label: "Circle", value: "50%" },
    ],
  },
  {
    key: "editor-shadow",
    label: "Editor card",
    group: "Shadows",
    kind: "select",
    options: [
      { label: "Outline only", value: border },
      { label: "Hairline", value: `0 1px 4px rgb(0 0 0 / 0.08), ${border}` },
      { label: "Soft", value: `0 4px 16px rgb(0 0 0 / 0.08), ${border}` },
      { label: "Lifted", value: `0 14px 32px -10px rgb(0 0 0 / 0.28), ${border}` },
    ],
  },
  {
    key: "fab-shadow",
    label: "New To-Do button",
    group: "Shadows",
    kind: "select",
    options: [
      { label: "None", value: "none" },
      {
        label: "Soft",
        value: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
      },
      { label: "Strong", value: "0 16px 30px -8px rgb(0 0 0 / 0.35)" },
    ],
  },
];

const { light, dark, vars } = JSON.parse(BUILT_IN_THEMES[0]!) as Theme;
/** The default theme, Sage, which is what globals.css holds. */
export const BASE: Theme = { light, dark, vars };

export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return `#${[...s].map((c) => c + c).join("")}`;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return `#${s}`;
  return null;
}

function rgba(hex: string): [number, number, number, number] {
  const h = normalizeHex(hex) ?? "#000000";
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5), h.length === 9 ? n(7) : 1];
}

const luminance = ([r, g, b]: number[]) => {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
};

/** WCAG contrast ratio; a translucent foreground is composited over the (opaque) background. */
export function contrast(fg: string, bg: string): number {
  const back = rgba(bg);
  const [r, g, b, a] = rgba(fg);
  const front = [r, g, b].map((c, i) => c * a + back[i]! * (1 - a));
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Tokens that track primary until they're given a colour of their own. */
const FOLLOWS: Record<string, string[]> = { primary: ["checkbox", "ring"] };

export function setColor(theme: Theme, mode: Mode, key: string, value: string): Theme {
  const colors = { ...theme[mode], [key]: value };
  for (const follower of FOLLOWS[key] ?? [])
    if (theme[mode][follower] === theme[mode][key]) colors[follower] = value;
  return { ...theme, [mode]: colors };
}

const safeVar = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 300 && !/[;{}<>]/.test(v);

export function loadTheme(raw: string | null): Theme {
  let stored: Partial<Theme> = {};
  try {
    stored = raw ? (JSON.parse(raw) as Partial<Theme>) : {};
  } catch {
    stored = {};
  }
  const colors = (mode: Mode) =>
    Object.fromEntries(
      COLORS.map(({ key }) => {
        const v = stored[mode]?.[key];
        return [key, (typeof v === "string" && normalizeHex(v)) || BASE[mode][key]!];
      }),
    );
  const vars = Object.fromEntries(
    VARS.map(({ key }) => {
      const v = stored.vars?.[key];
      return [key, safeVar(v) ? v : BASE.vars[key]!];
    }),
  );
  return { light: colors("light"), dark: colors("dark"), vars };
}

export const themeCss = (theme: Theme) => coreThemeCss({ name: "", ...theme });

/** A theme file, ready to drop into the app's themes folder. */
export function themeFile(theme: Theme, name: string): string {
  const { light, dark, vars } = theme;
  return `${JSON.stringify({ $schema: "./theme.schema.json", name, light, dark, vars }, null, 2)}\n`;
}
