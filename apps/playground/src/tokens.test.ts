import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PRESETS } from "./presets.ts";
import {
  BASE,
  COLORS,
  contrast,
  exportText,
  loadTheme,
  normalizeHex,
  setColor,
  themeCss,
  VARS,
  type Theme,
} from "./tokens.ts";

describe("normalizeHex", () => {
  test("accepts short, long and alpha forms with or without #", () => {
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex("#3D6B5A")).toBe("#3d6b5a");
    expect(normalizeHex(" #00000014 ")).toBe("#00000014");
  });
  test("rejects anything else", () => {
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("contrast", () => {
  test("black on white is 21:1, same colour is 1:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#3d6b5a", "#3d6b5a")).toBeCloseTo(1, 5);
  });
  test("composites a translucent foreground over the background", () => {
    expect(contrast("#00000000", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("themeCss", () => {
  test("puts light colours and sizes on :root and dark colours on :root.dark", () => {
    const css = themeCss({
      ...BASE,
      light: { ...BASE.light, background: "#ffffff" },
      dark: { ...BASE.dark, background: "#000000" },
    });
    expect(css).toMatch(/:root \{[^}]*--background: #ffffff;/);
    expect(css).toMatch(/:root\.dark \{[^}]*--background: #000000;/);
    expect(css).toMatch(/:root \{[^}]*--row-height: 30px;/);
  });
  test("can target the app's own .dark selector and only list changes", () => {
    const theme: Theme = { ...BASE, vars: { ...BASE.vars, "row-height": "34px" } };
    const css = themeCss(theme, { dark: ".dark", onlyChanged: true });
    expect(css).toBe(":root {\n  --row-height: 34px;\n}\n");
  });
});

describe("setColor", () => {
  test("carries tokens that follow primary along while they still match it", () => {
    const next = setColor(BASE, "light", "primary", "#2f6fdb");
    expect(next.light.primary).toBe("#2f6fdb");
    expect(next.light.checkbox).toBe("#2f6fdb");
    expect(next.light.ring).toBe("#2f6fdb");
    expect(next.dark.primary).toBe(BASE.dark.primary);
  });
  test("leaves a follower alone once it was set on its own", () => {
    const own = setColor(BASE, "light", "checkbox", "#111111");
    expect(setColor(own, "light", "primary", "#2f6fdb").light.checkbox).toBe("#111111");
  });
});

describe("loadTheme", () => {
  test("falls back to the base theme for missing or broken input", () => {
    expect(loadTheme(null)).toEqual(BASE);
    expect(loadTheme("{not json")).toEqual(BASE);
  });
  test("keeps valid stored values and drops unknown keys and bad colours", () => {
    const stored = JSON.stringify({
      light: { background: "#ABC", primary: "nope", bogus: "#000000" },
      dark: {},
      vars: { "row-height": "28px", bogus: "1px" },
    });
    const theme = loadTheme(stored);
    expect(theme.light.background).toBe("#aabbcc");
    expect(theme.light.primary).toBe(BASE.light.primary);
    expect(theme.light).not.toHaveProperty("bogus");
    expect(theme.vars["row-height"]).toBe("28px");
    expect(theme.vars).not.toHaveProperty("bogus");
  });
});

describe("exportText", () => {
  test("names the preset and carries CSS for globals.css plus the full JSON", () => {
    const theme: Theme = { ...BASE, light: { ...BASE.light, today: "#b07a12" } };
    const text = exportText(theme, "Sage, sharpened");
    expect(text).toContain("Sage, sharpened");
    expect(text).toContain("--today: #b07a12;");
    expect(text).not.toContain("--background:");
    const json = JSON.parse(text.slice(text.indexOf("```json") + 7, text.lastIndexOf("```")));
    expect(json.light.today).toBe("#b07a12");
  });
});

describe("schema and presets", () => {
  test("the base theme defines every control", () => {
    for (const { key } of COLORS) {
      expect(normalizeHex(BASE.light[key]!), `light ${key}`).not.toBeNull();
      expect(normalizeHex(BASE.dark[key]!), `dark ${key}`).not.toBeNull();
    }
    for (const { key } of VARS) expect(BASE.vars[key], key).toBeTruthy();
  });

  test("offers 5 to 7 named presets with a rationale and one recommendation", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(PRESETS.length).toBeLessThanOrEqual(7);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
    for (const p of PRESETS) expect(p.rationale.length).toBeGreaterThan(20);
    expect(PRESETS.filter((p) => p.recommended)).toHaveLength(1);
  });

  test.each(PRESETS.filter((p) => p.name !== "Current").map((p) => [p.name, p] as const))(
    "%s keeps body and meta text readable (AA) in light and dark",
    (_, { theme }) => {
      for (const mode of ["light", "dark"] as const) {
        const c = theme[mode];
        expect(contrast(c.foreground!, c.background!), `${mode} fg`).toBeGreaterThanOrEqual(7);
        for (const surface of ["background", "sidebar"] as const)
          expect(
            contrast(c["muted-foreground"]!, c[surface]!),
            `${mode} muted on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        for (const accent of ["today", "evening", "deadline", "checkbox"] as const)
          expect(contrast(c[accent]!, c.background!), `${mode} ${accent}`).toBeGreaterThanOrEqual(
            3,
          );
        expect(
          contrast(c["primary-foreground"]!, c.primary!),
          `${mode} on primary`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe("BASE mirrors globals.css", () => {
  const css = readFileSync(
    new URL("../../../packages/ui/src/styles/globals.css", import.meta.url),
    "utf8",
  );
  const vars = (selector: string) =>
    Object.fromEntries(
      [
        ...css
          .slice(css.indexOf(`${selector} {`))
          .split("}")[0]!
          .matchAll(/--([\w-]+):\s*([^;]+);/g),
      ].map((m) => [m[1]!, m[2]!.trim()]),
    );
  const root = vars(":root");
  const dark = vars(".dark");

  test("hex colours match in light and dark", () => {
    for (const { key } of COLORS) {
      if (root[key]?.startsWith("#")) expect(BASE.light[key], `light ${key}`).toBe(root[key]);
      if (dark[key]?.startsWith("#")) expect(BASE.dark[key], `dark ${key}`).toBe(dark[key]);
    }
  });

  test("every tweakable variable exists in globals.css with the same pixel value", () => {
    for (const { key } of VARS) {
      if (key === "spacing" || key === "radius") continue;
      expect(root, key).toHaveProperty(key);
      if (/^[\d.]+px$/.test(root[key]!)) expect(BASE.vars[key], key).toBe(root[key]);
    }
  });
});
