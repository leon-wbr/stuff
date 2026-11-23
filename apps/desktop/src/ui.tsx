import type { Id } from "@stuff/core/model";
import { Dialog, DialogContent, DialogTitle } from "@stuff/ui/components/dialog";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import {
  DeadlinePicker,
  MovePicker,
  ReminderPicker,
  RepeatPicker,
  TagPicker,
  WhenPicker,
} from "./pickers.tsx";

export type Panel =
  | { kind: "find"; query: string }
  | { kind: "settings" }
  | { kind: "when" | "deadline" | "move" | "tags" | "repeat" | "reminder"; ids: Id[] };

interface Panels {
  panel: Panel | null;
  open(p: Panel | null): void;
  sidebar: boolean;
  toggleSidebar(): void;
}

const PanelContext = createContext<Panels>({
  panel: null,
  open: () => {},
  sidebar: true,
  toggleSidebar: () => {},
});

const SIDEBAR_KEY = "sidebar-hidden";

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, open] = useState<Panel | null>(null);
  const [sidebar, setSidebar] = useState(() => localStorage.getItem(SIDEBAR_KEY) !== "1");
  const toggleSidebar = useCallback(
    () =>
      setSidebar((shown) => {
        localStorage.setItem(SIDEBAR_KEY, shown ? "1" : "0");
        return !shown;
      }),
    [],
  );
  return (
    <PanelContext.Provider value={{ panel, open, sidebar, toggleSidebar }}>
      {children}
    </PanelContext.Provider>
  );
}

export const usePanel = () => useContext(PanelContext);

const TITLES = {
  when: "When",
  deadline: "Deadline",
  move: "Move",
  tags: "Tags",
  repeat: "Repeat",
  reminder: "Reminder",
};

/** The pickers opened from the keyboard or a menu, shown as a small centred sheet. */
export function PickerSheet() {
  const { panel, open } = usePanel();
  const picker = panel && "ids" in panel ? panel : null;
  const done = () => open(null);
  return (
    <Dialog open={!!picker} onOpenChange={(o) => !o && done()}>
      <DialogContent className="max-w-72 rounded-2xl p-4 sm:max-w-72" showCloseButton={false}>
        <DialogTitle className="sr-only">{picker ? TITLES[picker.kind] : ""}</DialogTitle>
        {picker?.kind === "when" && <WhenPicker ids={picker.ids} done={done} />}
        {picker?.kind === "deadline" && <DeadlinePicker ids={picker.ids} done={done} />}
        {picker?.kind === "move" && <MovePicker ids={picker.ids} done={done} />}
        {picker?.kind === "tags" && <TagPicker ids={picker.ids} done={done} />}
        {picker?.kind === "reminder" && <ReminderPicker ids={picker.ids} done={done} />}
        {picker?.kind === "repeat" && picker.ids[0] && (
          <RepeatPicker id={picker.ids[0]} done={done} />
        )}
      </DialogContent>
    </Dialog>
  );
}
