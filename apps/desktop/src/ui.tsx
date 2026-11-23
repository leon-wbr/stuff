import type { Id } from "@stuff/core/model";
import { Dialog, DialogContent, DialogTitle } from "@stuff/ui/components/dialog";
import { createContext, useContext, useState, type ReactNode } from "react";
import { DeadlinePicker, MovePicker, RepeatPicker, TagPicker, WhenPicker } from "./pickers.tsx";

export type Panel =
  | { kind: "find"; query: string }
  | { kind: "settings" }
  | { kind: "when" | "deadline" | "move" | "tags" | "repeat"; ids: Id[] };

const PanelContext = createContext<{ panel: Panel | null; open(p: Panel | null): void }>({
  panel: null,
  open: () => {},
});

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panel, open] = useState<Panel | null>(null);
  return <PanelContext.Provider value={{ panel, open }}>{children}</PanelContext.Provider>;
}

export const usePanel = () => useContext(PanelContext);

const TITLES = { when: "When", deadline: "Deadline", move: "Move", tags: "Tags", repeat: "Repeat" };

/** The pickers opened from the keyboard, shown as a small centred sheet. */
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
        {picker?.kind === "repeat" && picker.ids[0] && (
          <RepeatPicker id={picker.ids[0]} done={done} />
        )}
      </DialogContent>
    </Dialog>
  );
}
