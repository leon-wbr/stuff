import { CopyIcon, MoonIcon, SealCheckIcon, SunIcon } from "@phosphor-icons/react";
import { Button } from "@stuff/ui/components/button";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { THEME_MESSAGE } from "./Frame.tsx";
import { PRESETS, RECOMMENDATIONS } from "./presets.ts";
import {
  COLORS,
  contrast,
  exportText,
  loadTheme,
  normalizeHex,
  setColor,
  themeCss,
  VARS,
  type Mode,
  type Theme,
  type VarControl,
} from "./tokens.ts";

const STORAGE = "stuff-design-playground";
const PAGES = [
  { label: "Today", view: "today" },
  {
    label: "Project with headings, editor open",
    view: "project:Kitchen refresh",
    edit: "Install the pendant lights",
  },
  { label: "Inbox", view: "inbox" },
  { label: "Upcoming", view: "upcoming" },
];
const FRAME = { width: 1180, height: 760 };
/** Tokens whose contrast against the background is worth showing while picking. */
const CHECKS: Record<string, number> = {
  foreground: 4.5,
  "muted-foreground": 4.5,
  today: 3,
  evening: 3,
  deadline: 3,
  checkbox: 3,
  inbox: 3,
  upcoming: 3,
  someday: 3,
  logbook: 3,
};

interface Saved {
  theme: Theme;
  preset: string;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? "null") as {
      theme?: unknown;
      preset?: string;
    } | null;
    if (raw?.theme)
      return { theme: loadTheme(JSON.stringify(raw.theme)), preset: raw.preset ?? "Current" };
  } catch {}
  return { theme: PRESETS[0]!.theme, preset: PRESETS[0]!.name };
}

const same = (a: Theme, b: Theme) => JSON.stringify(a) === JSON.stringify(b);

export function Playground() {
  const [{ theme, preset }, setSaved] = useState(load);
  const [mode, setMode] = useState<Mode>("light");
  const [preview, setPreview] = useState<"light" | "dark" | "both">("both");
  const [scale, setScale] = useState(0.45);
  const [exported, setExported] = useState<string | null>(null);
  const frames = useRef(new Set<HTMLIFrameElement>());
  const css = useMemo(() => themeCss(theme), [theme]);
  const base = PRESETS.find((p) => p.name === preset);
  const modified = !base || !same(base.theme, theme);

  useEffect(() => {
    localStorage.setItem(STORAGE, JSON.stringify({ theme, preset }));
    for (const f of frames.current) f.contentWindow?.postMessage({ type: THEME_MESSAGE, css }, "*");
    setExported(null);
  }, [theme, preset, css]);

  const update = (next: Theme) => setSaved({ theme: next, preset });
  const setVar = (key: string, value: string) =>
    update({ ...theme, vars: { ...theme.vars, [key]: value } });

  const copy = async () => {
    const text = exportText(theme, modified ? `${preset}, modified` : preset);
    setExported(text);
    await navigator.clipboard?.writeText(text).catch(() => {});
  };

  const modes: Mode[] = preview === "both" ? ["light", "dark"] : [preview];
  return (
    <div className="grid h-screen grid-cols-[400px_minmax(0,1fr)] text-[13px]">
      <aside
        aria-label="Design controls"
        className="flex min-h-0 flex-col border-r bg-sidebar select-text"
      >
        <header className="border-b px-5 pt-5 pb-4">
          <h1 className="text-lg font-semibold">stuff design playground</h1>
          <p className="mt-1 text-muted-foreground">
            The real app, with synthetic data. Every change applies live and is kept in this
            browser.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={copy}>
              <CopyIcon /> Copy settings
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => base && setSaved({ theme: base.theme, preset })}
              disabled={!modified || !base}
            >
              Reset to {preset}
            </Button>
          </div>
          {exported && (
            <div className="mt-3">
              <p className="mb-1 text-muted-foreground">
                Copied. Paste it to a worker; it's also here:
              </p>
              <textarea
                readOnly
                aria-label="Exported settings"
                value={exported}
                onFocus={(e) => e.target.select()}
                className="h-40 w-full rounded-md border bg-card p-2 font-mono text-[11px]"
              />
            </div>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10">
          <Section title="Presets">
            <ul className="flex flex-col gap-2">
              {PRESETS.map((p) => (
                <li key={p.name}>
                  <button
                    type="button"
                    aria-pressed={p.name === preset}
                    onClick={() => setSaved({ theme: p.theme, preset: p.name })}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      p.name === preset ? "border-primary bg-card" : "hover:bg-card"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      {p.name}
                      {p.recommended && (
                        <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-px text-[11px] font-medium text-primary-foreground">
                          <SealCheckIcon weight="fill" /> Start here
                        </span>
                      )}
                      {p.name === preset && modified && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          modified
                        </span>
                      )}
                    </span>
                    <span className="mt-1 block text-muted-foreground">{p.rationale}</span>
                    <span className="mt-2 flex gap-3">
                      <Swatches colors={p.theme.light} />
                      <Swatches colors={p.theme.dark} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="My recommendations">
            <ol className="flex list-decimal flex-col gap-1.5 pl-5">
              {RECOMMENDATIONS.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ol>
          </Section>
          <Section title="Preview">
            <Segmented<"light" | "dark" | "both">
              label="Show"
              value={preview}
              options={[
                ["light", "Light"],
                ["dark", "Dark"],
                ["both", "Both"],
              ]}
              onChange={setPreview}
            />
            <label className="mt-2 flex items-center gap-3">
              <span className="w-28 text-muted-foreground">Zoom</span>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-10 text-right tabular-nums">{Math.round(scale * 100)}%</span>
            </label>
          </Section>
          <Section title="Colours">
            <Segmented<Mode>
              label="Editing"
              value={mode}
              options={[
                ["light", "Light mode"],
                ["dark", "Dark mode"],
              ]}
              onChange={setMode}
            />
            {groups(COLORS).map(([group, controls]) => (
              <fieldset key={group} className="mt-4">
                <legend className="mb-1 font-medium">{group}</legend>
                {controls.map((c) => (
                  <ColorRow
                    key={`${mode}-${c.key}`}
                    label={c.label}
                    name={c.key}
                    value={theme[mode][c.key]!}
                    background={theme[mode].background!}
                    min={CHECKS[c.key]}
                    onChange={(v) => update(setColor(theme, mode, c.key, v))}
                  />
                ))}
              </fieldset>
            ))}
          </Section>
          {groups(VARS).map(([group, controls]) => (
            <Section key={group} title={group}>
              {controls.map((c) => (
                <VarRow key={c.key} control={c} value={theme.vars[c.key]!} onChange={setVar} />
              ))}
            </Section>
          ))}
          <Section title="Load settings">
            <textarea
              aria-label="Paste settings"
              placeholder="Paste a copied settings block here"
              onChange={(e) => {
                const text = e.target.value;
                const json = text.match(/```json\s*([\s\S]*?)```/)?.[1] ?? text;
                try {
                  JSON.parse(json);
                } catch {
                  return;
                }
                setSaved({ theme: loadTheme(json), preset: "Pasted" });
                e.target.value = "";
              }}
              className="h-20 w-full rounded-md border bg-card p-2 font-mono text-[11px]"
            />
          </Section>
        </div>
      </aside>
      <main className="min-h-0 overflow-auto bg-muted p-6">
        <div className="flex flex-wrap gap-6">
          {PAGES.flatMap((page) =>
            modes.map((m) => {
              const params = new URLSearchParams({ frame: "", view: page.view, mode: m });
              if (page.edit) params.set("edit", page.edit);
              return (
                <figure key={`${page.view}-${m}`} className="flex flex-col gap-1.5">
                  <figcaption className="flex items-center gap-1.5 text-muted-foreground">
                    {m === "dark" ? <MoonIcon /> : <SunIcon />}
                    {page.label}
                  </figcaption>
                  <div
                    className="overflow-hidden rounded-lg shadow-[0_8px_30px_rgb(0_0_0/0.12),0_0_0_1px_var(--border)]"
                    style={{ width: FRAME.width * scale, height: FRAME.height * scale }}
                  >
                    <iframe
                      title={`${page.label} (${m})`}
                      src={`?${params}`}
                      ref={(el) => {
                        if (!el) return;
                        frames.current.add(el);
                        return () => void frames.current.delete(el);
                      }}
                      onLoad={(e) =>
                        e.currentTarget.contentWindow?.postMessage(
                          { type: THEME_MESSAGE, css },
                          "*",
                        )
                      }
                      style={{
                        width: FRAME.width,
                        height: FRAME.height,
                        transform: `scale(${scale})`,
                        transformOrigin: "0 0",
                      }}
                      className="border-0"
                    />
                  </div>
                </figure>
              );
            }),
          )}
        </div>
      </main>
    </div>
  );
}

function groups<T extends { group: string }>(items: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(item.group, [...(out.get(item.group) ?? []), item]);
  return [...out];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ colors }: { colors: Record<string, string> }) {
  return (
    <span className="flex overflow-hidden rounded-md shadow-[0_0_0_1px_var(--border)]">
      {["background", "sidebar", "primary", "today", "evening", "deadline"].map((k) => (
        <span key={k} className="size-4" style={{ background: colors[k] }} />
      ))}
    </span>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(value: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex rounded-md bg-muted p-0.5">
      {props.options.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={props.value === value}
          onClick={() => props.onChange(value)}
          className={`flex-1 rounded px-2 py-1 ${props.value === value ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ColorRow(props: {
  label: string;
  name: string;
  value: string;
  background: string;
  min?: number;
  onChange(value: string): void;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const valid = normalizeHex(text) !== null;
  const ratio = props.min ? contrast(props.value, props.background) : null;
  const alpha = props.value.length === 9 ? props.value.slice(7) : "";
  return (
    <div className="flex items-center gap-2 py-1">
      <input
        type="color"
        aria-label={`${props.label} colour`}
        value={props.value.slice(0, 7)}
        onChange={(e) => props.onChange(e.target.value + alpha)}
        className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <label htmlFor={`hex-${props.name}`} className="min-w-0 flex-1 truncate">
        {props.label}
      </label>
      {ratio !== null && (
        <span
          title={`Contrast against the background; needs ${props.min}:1`}
          className={`text-[11px] tabular-nums ${ratio >= props.min! ? "text-muted-foreground" : "font-semibold text-destructive"}`}
        >
          {ratio.toFixed(1)}:1
        </span>
      )}
      <input
        id={`hex-${props.name}`}
        aria-label={`${props.label} hex`}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) props.onChange(hex);
        }}
        onBlur={() => setText(props.value)}
        className={`w-[86px] rounded border bg-card px-1.5 py-0.5 font-mono text-[12px] ${valid ? "" : "border-destructive"}`}
      />
    </div>
  );
}

function VarRow(props: {
  control: VarControl;
  value: string;
  onChange(key: string, value: string): void;
}) {
  const c = props.control;
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-36 shrink-0">{c.label}</span>
      {c.kind === "range" ? (
        <>
          <input
            type="range"
            min={c.min}
            max={c.max}
            step={c.step}
            value={parseFloat(props.value)}
            onChange={(e) => props.onChange(c.key, `${e.target.value}${c.unit}`)}
            className="min-w-0 flex-1 accent-primary"
          />
          <span className="w-12 text-right font-mono text-[12px] tabular-nums">{props.value}</span>
        </>
      ) : (
        <select
          value={props.value}
          onChange={(e) => props.onChange(c.key, e.target.value)}
          className="min-w-0 flex-1 rounded border bg-card px-1.5 py-1"
        >
          {!c.options.some((o) => o.value === props.value) && (
            <option value={props.value}>Custom</option>
          )}
          {c.options.map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
