import { ArchiveIcon, MoonIcon, StarIcon, TrayIcon } from "@phosphor-icons/react";
import { add, placement, type Where } from "@stuff/core/ops";
import { Button } from "@stuff/ui/components/button";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { useChange, useWorld } from "./app.ts";

const WHEN = [
  { where: "inbox", label: "Inbox", Icon: TrayIcon, color: "text-inbox" },
  { where: "today", label: "Today", Icon: StarIcon, color: "text-today" },
  { where: "evening", label: "This Evening", Icon: MoonIcon, color: "text-evening" },
  { where: "someday", label: "Someday", Icon: ArchiveIcon, color: "text-someday" },
] as const;

/** The Quick Entry window: a to-do from anywhere, opened with Ctrl+Space. */
export function QuickEntry() {
  const change = useChange();
  const w = useWorld();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState<(typeof WHEN)[number]["where"]>("inbox");
  const [list, setList] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const reset = () => {
    setTitle("");
    setNotes("");
    setWhen("inbox");
    setList("");
  };
  const close = () => {
    reset();
    void invoke("quick_entry");
  };
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);
  useEffect(() => {
    const off = listen("quick-entry", () => input.current?.focus());
    const blur = getCurrentWindow().onFocusChanged(
      ({ payload }) => !payload && void getCurrentWindow().hide(),
    );
    return () => {
      void off.then((f) => f());
      void blur.then((f) => f());
    };
  }, []);
  const save = () => {
    if (!title.trim()) return close();
    change((ctx) => {
      const timing = list ? placement(when === "inbox" ? "anytime" : when, ctx.today) : {};
      return add("todo", { title: title.trim(), notes, ...timing }, (list || when) as Where)(ctx);
    });
    close();
  };
  return (
    <form
      data-tauri-drag-region
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => e.key === "Escape" && close()}
      className="flex h-screen flex-col gap-2 rounded-xl border bg-card p-4 text-ui"
    >
      <input
        ref={input}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New To-Do"
        aria-label="Title"
        className="bg-transparent text-[15px] font-medium outline-none placeholder:text-muted-foreground/60"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        aria-label="Notes"
        rows={2}
        className="flex-1 resize-none bg-transparent outline-none placeholder:text-muted-foreground/60"
      />
      <div className="flex items-center gap-1">
        {WHEN.map(({ where, label, Icon, color }) => (
          <button
            key={where}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={when === where}
            onClick={() => setWhen(where)}
            className={`rounded-md p-1.5 ${when === where ? "bg-accent" : "hover:bg-muted"}`}
          >
            <Icon
              weight={where === "today" || where === "evening" ? "fill" : "regular"}
              className={`size-4 ${color}`}
            />
          </button>
        ))}
        <select
          aria-label="List"
          value={list}
          onChange={(e) => setList(e.target.value)}
          className="ml-2 max-w-48 rounded-md bg-muted px-2 py-1"
        >
          <option value="">No list</option>
          {w.areas
            .filter((a) => !a.trashed)
            .map((a) => (
              <option key={a.id} value={`area:${a.id}`}>
                {a.title}
              </option>
            ))}
          {w.projects
            .filter((p) => p.status === "open" && !p.trashed)
            .map((p) => (
              <option key={p.id} value={`project:${p.id}`}>
                {p.title}
              </option>
            ))}
        </select>
        <span className="flex-1" />
        <Button type="button" size="sm" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}
