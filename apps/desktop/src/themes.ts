import {
  collectThemes,
  DEFAULT_THEME,
  resolveTheme,
  themeCss,
  type ThemeFile,
} from "@stuff/core/theme";
import { BUILT_IN_THEMES } from "@stuff/ui/themes";
import { useEffect, useSyncExternalStore } from "react";
import { themesFolder } from "./app.ts";

/** This window's view of the built-in themes plus the themes folder, re-read when it changes. */
let state = { ...collectThemes(BUILT_IN_THEMES, []), dir: null as string | null };
const subscribers = new Set<() => void>();
let watching = false;

async function reload() {
  const { dir, files } = await themesFolder
    .load()
    .catch(() => ({ dir: null, files: [] as ThemeFile[] }));
  state = { ...collectThemes(BUILT_IN_THEMES, files), dir };
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (!watching) {
    watching = true;
    themesFolder.onChange(() => void reload());
    void reload();
  }
  return () => void subscribers.delete(notify);
}

export const useThemes = () => useSyncExternalStore(subscribe, () => state);

const style = document.createElement("style");

/** Sets the named theme's custom properties; the default (or a theme that's gone) sets none. */
export function useApplyTheme(name: string) {
  const { themes } = useThemes();
  const theme = themes.find((t) => t.name === name);
  const base = themes.find((t) => t.name === DEFAULT_THEME)!;
  const css = theme && theme !== base ? themeCss(resolveTheme(theme, base)) : "";
  useEffect(() => {
    style.textContent = css;
    if (!style.isConnected) document.head.append(style);
  }, [css]);
}
