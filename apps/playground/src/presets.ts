import { BUILT_IN_THEMES } from "@stuff/ui/themes";
import { loadTheme, type Theme } from "./tokens.ts";

export interface Preset {
  name: string;
  rationale: string;
  recommended?: boolean;
  theme: Theme;
}

const RATIONALES: Record<string, string> = {
  Sage: "The default: the original sage with the contrast failures fixed, the cream taken out of the background, and more presence for titles and rows.",
  Original:
    "What the app shipped before Sage: warm off-white, sage primary. Secondary text and the Today star fail contrast in light mode.",
  "Calm Blue":
    "Close to Things: pure white, a cool grey sidebar, one confident blue and a yellow star. Familiar enough to switch without noticing.",
  "High Contrast":
    "For tired eyes and bright rooms: black on white, AAA secondary text, heavier outlines and a slightly larger body size.",
  "Paper & Ink":
    "A notebook: warm paper, ink-blue checkmarks and serif list titles. Lamp-lit browns in the dark. Cosy, and deliberately less app-like.",
  Graphite:
    "A dense pro tool: cool greys, colour only where time matters (Today, Upcoming, deadlines), 26px rows and a narrower sidebar.",
  Persimmon:
    "A committed persimmon on true white, round checkboxes, SF Rounded and big bold titles. Friendly and unmistakably not Things.",
};

/** The app's built-in theme files. */
export const PRESETS: Preset[] = BUILT_IN_THEMES.map((text) => {
  const { name } = JSON.parse(text) as { name: string };
  return {
    name,
    rationale: RATIONALES[name] ?? "",
    recommended: name === "Sage",
    theme: loadTheme(text),
  };
});

/** Changes beyond colour, from the impeccable critique of the current UI. */
export const RECOMMENDATIONS = [
  "Fix light-mode contrast first: secondary text is 3.6:1 (needs 4.5), the Today star 2.4:1 and Someday 2.7:1 (need 3 as icons).",
  "Type scale: keep 13px body, raise meta (tags, dates, counts) from 11 to 12px, and titles from 24 to 26px with a 650 weight so a list reads title, then rows.",
  "Give project headings their own step (about 15px, semibold) instead of body size in primary colour; there's nothing between 13 and 24px now.",
  "Density: 32px rows read calmer than 30px without losing much; keep 232–240px for the sidebar.",
  "Checkbox: 16px with a darker outline (text colour at ~35%). Today's 15px box at 45% muted reads as disabled. Pick one shape for to-dos and checklist items.",
  "Fewer hues: colour only the lists where time matters (Today, Upcoming, deadlines). Inbox, Logbook and Someday can go neutral or primary.",
  "Hierarchy: give Projects/Areas a quiet group label like Tags has, and replace the floating + button with a toolbar button, which is the Mac idiom.",
];
