import { saveSettings } from "@stuff/core/ops";
import { Button } from "@stuff/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@stuff/ui/components/dialog";
import { Input } from "@stuff/ui/components/input";
import { useState, type ReactNode } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { usePanel } from "./ui.tsx";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function KeySetup() {
  const [nsec, setNsec] = useState("");
  const { npub, keyError } = Stuff.useSelector((s) => s.context);
  const saving = Stuff.useSelector(
    (s) => s.matches({ key: "creating" }) || s.matches({ key: "importing" }),
  );
  const { send } = Stuff.useActorRef();
  if (npub)
    return (
      <p className="text-ui">
        Your key:{" "}
        <span className="selectable font-mono text-xs break-all text-muted-foreground">{npub}</span>
      </p>
    );
  return (
    <>
      <p className="text-ui text-muted-foreground">
        stuff keeps your Nostr key in the macOS keychain and encrypts every to-do to it before it
        leaves this Mac. Use the same key on each Mac you sync.
      </p>
      <Button disabled={saving} onClick={() => send({ type: "key.create" })}>
        Create a new key
      </Button>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="nsec1…"
          autoComplete="off"
          value={nsec}
          onChange={(e) => setNsec(e.target.value)}
          aria-label="nsec"
        />
        <Button
          variant="secondary"
          disabled={saving || !nsec}
          onClick={() => send({ type: "key.import", nsec })}
        >
          Import
        </Button>
      </div>
      {keyError && <p className="text-ui text-destructive">{keyError}</p>}
    </>
  );
}

const THEMES = ["system", "light", "dark"] as const;

function Appearance() {
  const w = useWorld();
  const change = useChange();
  const theme = w.settings?.theme ?? "system";
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Appearance">
      {THEMES.map((t) => (
        <Button
          key={t}
          size="sm"
          role="radio"
          aria-checked={theme === t}
          variant={theme === t ? "default" : "secondary"}
          onClick={() => change(saveSettings({ theme: t }))}
        >
          {t[0]!.toUpperCase() + t.slice(1)}
        </Button>
      ))}
    </div>
  );
}

export const useTheme = () => useWorld().settings?.theme ?? "system";

export function SettingsDialog({ extra }: { extra?: ReactNode }) {
  const { panel, open } = usePanel();
  return (
    <Dialog open={panel?.kind === "settings"} onOpenChange={(o) => !o && open(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Sync, import, backup and appearance
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {extra}
          <Section title="Appearance">
            <Appearance />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
