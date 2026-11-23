import { toDate } from "@stuff/core/days";
import { world } from "@stuff/core/lists";
import { appMachine, type View } from "@stuff/core/machine";
import type { Op } from "@stuff/core/ops";
import type { ThemeFile } from "@stuff/core/theme";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { createActorContext } from "@xstate/react";
import { useCallback, useMemo } from "react";

export const windowLabel = getCurrentWindow().label;
export const isQuickEntry = new URLSearchParams(location.search).get("window") === "quick";
/** Sync, reminders and repeat spawning run in the first main window only. */
export const isPrimary = windowLabel === "main";

const machine = appMachine(
  {
    keyStatus: () => invoke("key_status"),
    saveKey: (command, nsec) => invoke(command, { nsec }),
    load: () => invoke("store_load"),
    save: (docs, dirty) => invoke("store_save", { docs, dirty }),
    listen: (onDocs) => {
      const off = listen<{ docs: unknown[] }>("store-changed", ({ payload }) =>
        onDocs(payload.docs),
      );
      return () => void off.then((unlisten) => unlisten());
    },
  },
  (localStorage.getItem(`view:${windowLabel}`) as View | null) ?? "today",
);

export const Stuff = createActorContext(machine);

export const themesFolder = {
  load: () => invoke<{ dir: string; files: ThemeFile[] }>("themes_load"),
  onChange: (cb: () => void) => {
    const off = listen("themes-changed", cb);
    return () => void off.then((unlisten) => unlisten());
  },
  reveal: (dir: string) => revealItemInDir(`${dir}/theme.schema.json`),
};

export function useWorld() {
  const docs = Stuff.useSelector((s) => s.context.docs);
  const today = Stuff.useSelector((s) => s.context.today);
  return useMemo(() => {
    const w = world(docs.values());
    w.keepDoneSince = toDate(today).getTime();
    return w;
  }, [docs, today]);
}

export function useChange() {
  const { send } = Stuff.useActorRef();
  return useCallback((op: Op) => send({ type: "change", op }), [send]);
}
