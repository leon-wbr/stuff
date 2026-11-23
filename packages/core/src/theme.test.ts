import { describe, expect, test } from "vitest";
import {
  collectThemes,
  COLOR_KEYS,
  parseTheme,
  resolveTheme,
  themeCss,
  VAR_KEYS,
  type Theme,
} from "./theme.ts";

const base: Theme = {
  name: "Base",
  light: Object.fromEntries(COLOR_KEYS.map((k) => [k, "#ffffff"])),
  dark: Object.fromEntries(COLOR_KEYS.map((k) => [k, "#000000"])),
  vars: Object.fromEntries(VAR_KEYS.map((k) => [k, "1px"])),
};

const parse = (value: unknown) => parseTheme(JSON.stringify(value));

describe("parseTheme", () => {
  test("reads name, colours and variables", () => {
    const result = parse({
      $schema: "./theme.schema.json",
      name: "Night",
      light: { background: "#fafafa" },
      dark: { primary: "oklch(0.7 0.1 150)" },
      vars: { "row-height": "28px", "font-ui": '"Avenir Next", sans-serif' },
    });
    expect(result).toEqual({
      ok: true,
      theme: {
        name: "Night",
        light: { background: "#fafafa" },
        dark: { primary: "oklch(0.7 0.1 150)" },
        vars: { "row-height": "28px", "font-ui": '"Avenir Next", sans-serif' },
      },
    });
  });

  test("ignores unknown keys and treats missing sections as empty", () => {
    const result = parse({
      name: "Sparse",
      author: "me",
      light: { background: "#fff", bogus: "#000", "font-ui": "serif" },
      vars: { "row-height": "28px", "--evil": "1px" },
    });
    expect(result).toEqual({
      ok: true,
      theme: {
        name: "Sparse",
        light: { background: "#fff" },
        dark: {},
        vars: { "row-height": "28px" },
      },
    });
  });

  test.each([
    ["not json", "{nope", /JSON/],
    ["an array", "[]", /object/],
    ["no name", JSON.stringify({ light: {} }), /name/],
    ["a blank name", JSON.stringify({ name: "  " }), /name/],
    ["a section that isn't an object", JSON.stringify({ name: "x", light: "red" }), /light/],
    ["a non-string value", JSON.stringify({ name: "x", vars: { "row-height": 30 } }), /row-height/],
  ])("rejects %s", (_, text, error) => {
    const result = parseTheme(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(error);
  });

  test.each([
    "red; } body { display: none",
    "red}",
    "{",
    "url(https://example.com/x.png)",
    "URL(x)",
    "@import x",
    "</style><script>",
    "\\7d",
    "",
    "x".repeat(301),
  ])("rejects the unsafe value %j", (value) => {
    const result = parse({ name: "x", dark: { background: value } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dark\.background/);
  });
});

describe("collectThemes", () => {
  const file = (name: string, extra = {}) => JSON.stringify({ name, ...extra });

  test("lists built-ins first, then folder files, and reports the broken ones by file", () => {
    const { themes, errors } = collectThemes(
      [file("Sage"), file("Original")],
      [
        { file: "b.json", text: file("Night") },
        { file: "broken.json", text: "{" },
        { file: "a.json", text: file("Dawn") },
        { file: "copy.json", text: file("Sage") },
      ],
    );
    expect(themes.map((t) => [t.name, t.file])).toEqual([
      ["Sage", undefined],
      ["Original", undefined],
      ["Dawn", "a.json"],
      ["Night", "b.json"],
    ]);
    expect(errors).toEqual([
      { file: "broken.json", error: "Not valid JSON." },
      { file: "copy.json", error: 'A theme named "Sage" already exists.' },
    ]);
  });
});

describe("resolveTheme", () => {
  test("fills every missing key from the base", () => {
    const theme = resolveTheme(
      { name: "T", light: { background: "#eee" }, dark: {}, vars: {} },
      base,
    );
    expect(theme.name).toBe("T");
    expect(theme.light.background).toBe("#eee");
    expect(theme.light.foreground).toBe("#ffffff");
    expect(theme.dark).toEqual(base.dark);
    expect(theme.vars).toEqual(base.vars);
  });

  test("checkbox and ring follow a theme's primary unless it sets them", () => {
    const theme = resolveTheme(
      { name: "T", light: { primary: "#2f6fdb", ring: "#111111" }, dark: {}, vars: {} },
      base,
    );
    expect(theme.light.checkbox).toBe("#2f6fdb");
    expect(theme.light.ring).toBe("#111111");
    expect(theme.dark.checkbox).toBe("#000000");
  });
});

describe("themeCss", () => {
  test("puts light colours and variables on :root and dark colours on :root.dark", () => {
    const css = themeCss({
      name: "T",
      light: { background: "#eee" },
      dark: { background: "#111" },
      vars: { "row-height": "28px" },
    });
    expect(css).toBe(
      ":root {\n  --background: #eee;\n  --row-height: 28px;\n}\n:root.dark {\n  --background: #111;\n}\n",
    );
  });

  test("is empty for an empty theme", () => {
    expect(themeCss({ name: "T", light: {}, dark: {}, vars: {} })).toBe("");
  });
});
