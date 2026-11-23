import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { DEFAULT_THEME } from "@stuff/core/theme";
import { isQuickEntry, Stuff, useWorld } from "./app.ts";
import { ListView } from "./ListView.tsx";
import { QuickEntry } from "./QuickEntry.tsx";
import { QuickFind } from "./QuickFind.tsx";
import { SettingsDialog, useTheme } from "./Settings.tsx";
import { useApplyTheme } from "./themes.ts";
import { Sidebar } from "./Sidebar.tsx";
import { PanelProvider, PickerSheet, usePanel } from "./ui.tsx";
import { useShortcuts } from "./useShortcuts.ts";
import { useReminders } from "./useReminders.ts";
import { useSync } from "./sync.ts";
import { DataSettings } from "./DataSettings.tsx";

function useAppearance() {
  const theme = useTheme();
  useApplyTheme(useWorld().settings?.themeName ?? DEFAULT_THEME);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    void getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

/** Moves Today along at midnight and spawns repeating to-dos whose day has come. */
function useDayTicker() {
  const { send } = Stuff.useActorRef();
  useEffect(() => {
    const timer = setInterval(() => send({ type: "tick" }), 60_000);
    return () => clearInterval(timer);
  }, [send]);
}

function Main() {
  useShortcuts();
  useDayTicker();
  useSync();
  useReminders();
  const error = Stuff.useSelector((s) => s.context.error);
  const { sidebar } = usePanel();
  return (
    <div
      className={`grid h-screen text-ui ${sidebar ? "grid-cols-[var(--sidebar-user-width,var(--sidebar-width))_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)]"}`}
    >
      {sidebar && <Sidebar />}
      <main className="min-h-0 min-w-0">
        <ListView />
      </main>
      <QuickFind />
      <PickerSheet />
      <SettingsDialog extra={<DataSettings />} />
      {error && (
        <p
          role="alert"
          className="fixed bottom-14 left-1/2 -translate-x-1/2 rounded-lg bg-destructive px-3 py-1.5 text-sm text-white shadow"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function App() {
  useAppearance();
  const loading = Stuff.useSelector((s) => s.matches({ data: "loading" }));
  if (loading) return null;
  return <PanelProvider>{isQuickEntry ? <QuickEntry /> : <Main />}</PanelProvider>;
}
