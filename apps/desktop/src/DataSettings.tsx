import { TrashIcon } from "@phosphor-icons/react";
import { stuff } from "@stuff/core/extensions";
import { DEFAULT_RELAYS, normalizeRelay } from "@stuff/core/relays";
import { saveSettings } from "@stuff/core/ops";
import { thingsCounts, type ThingsData } from "@stuff/core/things";
import { Button } from "@stuff/ui/components/button";
import { Input } from "@stuff/ui/components/input";
import { Switch } from "@stuff/ui/components/switch";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Stuff, useChange, useWorld } from "./app.ts";
import { KeySetup, Section } from "./Settings.tsx";
import { setSyncConfig, useSyncConfig, useSyncStatus } from "./sync.ts";

const MODES = [
  { id: "off", title: "Off" },
  { id: "nostr", title: "Nostr" },
  { id: "folder", title: "Folder…" },
] as const;

function Sync() {
  const config = useSyncConfig();
  const status = useSyncStatus();
  if (!config) return null;
  const pickFolder = async (encrypt = config.encrypt ?? false) => {
    const path = await open({ directory: true, title: "Sync through this folder" });
    if (typeof path === "string") await setSyncConfig({ adapter: "folder", path, encrypt });
  };
  return (
    <Section title="Sync">
      <div className="flex gap-1.5" role="radiogroup" aria-label="Sync">
        {MODES.map((m) => (
          <Button
            key={m.id}
            size="sm"
            role="radio"
            aria-checked={config.adapter === m.id}
            variant={config.adapter === m.id ? "default" : "secondary"}
            onClick={() =>
              m.id === "folder" ? void pickFolder() : void setSyncConfig({ adapter: m.id })
            }
          >
            {m.title}
          </Button>
        ))}
      </div>
      {config.adapter === "off" && (
        <p className="text-[13px] text-muted-foreground">
          Everything stays on this Mac. Choose Nostr or a folder (in iCloud Drive, Google Drive,
          Dropbox or a Syncthing share) to use stuff on several Macs.
        </p>
      )}
      {config.adapter === "nostr" && (
        <>
          <KeySetup />
          <Relays />
        </>
      )}
      {config.adapter === "folder" && (
        <>
          <p className="text-[13px] text-muted-foreground">
            Each item is one file in{" "}
            <span className="selectable font-mono text-xs break-all">{config.path}</span>. Point
            your other Macs at the same folder.
          </p>
          <div className="flex items-center gap-2 text-[13px]">
            <Switch
              checked={!!config.encrypt}
              onCheckedChange={(encrypt) => void setSyncConfig({ ...config, encrypt })}
              aria-label="Encrypt with my key"
            />
            <span className="flex-1">Encrypt with my key</span>
            <Button size="sm" variant="secondary" onClick={() => void pickFolder()}>
              Change folder…
            </Button>
          </div>
          {config.encrypt && <KeySetup />}
        </>
      )}
      {config.adapter !== "off" && <p className="text-xs text-muted-foreground">{status.text}</p>}
    </Section>
  );
}

function Relays() {
  const w = useWorld();
  const change = useChange();
  const relays = w.settings?.relays ?? DEFAULT_RELAYS;
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const save = (next: typeof relays) => change(saveSettings({ relays: next }));
  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        Each to-do, project and list is encrypted to your key and stored on these relays. They see
        when you change something and how many items you have, never what they say.
      </p>
      <ul className="flex flex-col gap-1">
        {relays.map((r) => (
          <li key={r.url} className="flex items-center gap-2 text-[13px]">
            <Switch
              checked={r.enabled}
              onCheckedChange={() =>
                save(relays.map((x) => (x.url === r.url ? { ...x, enabled: !x.enabled } : x)))
              }
              aria-label={`Use ${r.url}`}
            />
            <span className="flex-1 truncate font-mono text-xs">{r.url}</span>
            <button
              type="button"
              aria-label={`Remove ${r.url}`}
              onClick={() => save(relays.filter((x) => x.url !== r.url))}
              className="rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <TrashIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const url = normalizeRelay(input);
          if (!url) return setError("Relays are wss:// addresses (ws:// only on this Mac)");
          setError("");
          setInput("");
          if (!relays.some((r) => r.url === url)) save([...relays, { url, enabled: true }]);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="wss://relay.example.com"
          aria-label="Relay address"
        />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
    </>
  );
}

function ThingsImport() {
  const change = useChange();
  const today = Stuff.useSelector((s) => s.context.today);
  const [data, setData] = useState<ThingsData | null>(null);
  const [message, setMessage] = useState("");
  const pick = async () => {
    const path = await open({ filters: [{ name: "Things database", extensions: ["sqlite"] }] });
    if (typeof path !== "string") return;
    try {
      setData(await invoke<ThingsData>("things_read", { path }));
      setMessage("");
    } catch (e) {
      setMessage(String(e));
    }
  };
  const counts = data && thingsCounts(data, today);
  return (
    <Section title="Import from Things">
      <p className="text-[13px] text-muted-foreground">
        Choose a <code>main.sqlite</code> from a Things backup (inside a{" "}
        <code>.thingsdatabase</code> folder). stuff only reads it.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => void pick()}>
          Choose database…
        </Button>
        {data && (
          <Button
            onClick={() => {
              change(stuff.importers.get("things")!.op(data));
              setData(null);
              setMessage("Imported.");
            }}
          >
            Import into stuff
          </Button>
        )}
      </div>
      {counts && (
        <p className="text-[13px]" data-testid="things-counts">
          {counts.areas} areas, {counts.projects} projects ({counts.openProjects} open),{" "}
          {counts.todos} to-dos, {counts.today} in Today, {counts.inbox} in the Inbox.
        </p>
      )}
      {message && <p className="text-[13px] text-muted-foreground">{message}</p>}
    </Section>
  );
}

function Backup() {
  const change = useChange();
  const docs = Stuff.useSelector((s) => s.context.docs);
  const [message, setMessage] = useState("");
  return (
    <Section title="Backup">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          onClick={async () => {
            const path = await save({
              defaultPath: "stuff-backup.json",
              filters: [{ name: "JSON", extensions: ["json"] }],
            });
            if (!path) return;
            await invoke("text_write", {
              path,
              text: stuff.exporters.get("json")!.run(docs.values()),
            });
            setMessage(`Saved ${docs.size} items.`);
          }}
        >
          Export…
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            const path = await open({ filters: [{ name: "JSON", extensions: ["json"] }] });
            if (typeof path !== "string") return;
            const text = await invoke<string>("text_read", { path });
            change(stuff.importers.get("json")!.op(text));
            setMessage("Restored.");
          }}
        >
          Restore…
        </Button>
      </div>
      {message && <p className="text-[13px] text-muted-foreground">{message}</p>}
    </Section>
  );
}

export function DataSettings() {
  return (
    <>
      <Sync />
      <ThingsImport />
      <Backup />
    </>
  );
}
