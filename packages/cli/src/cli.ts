import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs, type ArgSpec, type CommandDef } from "@stuff/core/commands";
import { dayOf } from "@stuff/core/days";
import type { Doc } from "@stuff/core/doc";
import { stuff } from "@stuff/core/extensions";
import { hlc } from "@stuff/core/hlc";
import { randomId, type Ctx } from "@stuff/core/ops";
import { openStore } from "./store";

export interface Env {
  [key: string]: string | undefined;
}

/** Where the app keeps its store: the app data dir, per `STUFF_PROFILE` like `lib.rs`. */
export function defaultDb(env: Env) {
  const profile =
    env.STUFF_PROFILE && /^[a-zA-Z0-9]+$/.test(env.STUFF_PROFILE) ? env.STUFF_PROFILE : "";
  return join(
    env.HOME ?? homedir(),
    "Library/Application Support/app.stuff.desktop",
    profile,
    "stuff.sqlite",
  );
}

/** Commands only the CLI has, because they read or write files. */
const hostCommands: Omit<CommandDef, "run">[] = [
  {
    name: "commands",
    summary: "Lists every command with its arguments",
    write: false,
    args: {},
  },
  {
    name: "import",
    summary: "Merges a file into the store (newer edits win per field)",
    write: true,
    args: {
      file: { type: "string", summary: "path to the file", positional: true, required: true },
      format: { type: "enum", summary: "importer (json)", values: textImporters() },
    },
  },
  {
    name: "export",
    summary: "Prints every object in an export format (raw, not wrapped in JSON)",
    write: false,
    args: {
      format: { type: "enum", summary: "exporter (json)", values: [...stuff.exporters.keys()] },
    },
  },
];

function textImporters() {
  return [...stuff.importers.values()].filter((i) => i.input === "text").map((i) => i.id);
}

const GLOBAL: Record<string, ArgSpec> = {
  db: { type: "string", summary: "store file (default: the app's, or $STUFF_DB)" },
  human: { type: "boolean", summary: "short text instead of JSON" },
  json: { type: "boolean", summary: "JSON output (the default)" },
};

const describe = (c: Omit<CommandDef, "run">) => ({
  name: c.name,
  summary: c.summary,
  write: c.write,
  args: c.args,
});

const help = () =>
  [
    "stuff <command> [args] [--human] [--db path]",
    "",
    ...[...stuff.commands.values(), ...hostCommands].map(
      (c) => `  ${c.name.padEnd(9)} ${c.summary}`,
    ),
    "",
    "`stuff commands` prints every command's arguments as JSON.",
  ].join("\n");

/** Pulls the global options out of argv. */
function globals(argv: string[]) {
  const rest: string[] = [];
  const opts: { db?: string; human?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--human" || a === "-H") opts.human = true;
    else if (a === "--json") opts.human = false;
    else if (a === "--db") opts.db = argv[++i];
    else if (a.startsWith("--db=")) opts.db = a.slice(5);
    else rest.push(a);
  }
  return { opts, rest };
}

type Item = Record<string, unknown> & { id?: string; title?: string };

function line(i: Item) {
  const mark =
    i.status === "completed"
      ? "✓"
      : i.status === "canceled"
        ? "×"
        : i.type === "project"
          ? "◔"
          : "○";
  const extra = [
    i.when && `when ${i.when as string}${i.evening ? " evening" : ""}`,
    i.deadline && `due ${i.deadline as string}`,
    Array.isArray(i.tags) && i.tags.length && `#${i.tags.join(" #")}`,
  ].filter(Boolean);
  const title = i.title || (i.kind ? `${i.kind as string}` : "(untitled)");
  return `${"status" in i || i.type ? mark + " " : ""}${title}${extra.length ? `  ${extra.join(", ")}` : ""}  ${String(i.id ?? "").slice(0, 8)}`;
}

/** Short text for people: one line per item, sections as headings. */
export function human(result: unknown): string {
  if (Array.isArray(result)) return result.map((i) => line(i as Item)).join("\n");
  if (result && typeof result === "object") {
    const r = result as Item & {
      sections?: { title?: string; key: string; items: Item[] }[];
      items?: Item[];
    };
    if (r.sections)
      return (
        r.sections
          .filter((s) => s.items.length)
          .map((s) =>
            [...(s.title ? [`${s.title}:`] : []), ...s.items.map((i) => `  ${line(i)}`)].join("\n"),
          )
          .join("\n") || "(empty)"
      );
    if (r.items) return r.items.map((i) => line(i)).join("\n") || "(empty)";
    if (r.name && r.args) return `${r.name as string}: ${r.summary as string}`;
    const fields = Object.entries(r)
      .filter(
        ([k, v]) =>
          !["id", "type", "title"].includes(k) &&
          v !== null &&
          v !== "" &&
          !(Array.isArray(v) && !v.length),
      )
      .map(([k, v]) => `  ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    return [line(r), ...fields].join("\n");
  }
  return String(result);
}

/** Runs one CLI invocation; returns what to print and the exit code. */
export function run(
  argv: string[],
  env: Env = process.env,
  now = Date.now(),
): { out: string; code: number } {
  const { opts, rest } = globals(argv);
  const [name, ...args] = rest;
  const print = (result: unknown) =>
    opts.human ? human(result) : JSON.stringify({ ok: true, result }, null, 2);
  try {
    if (!name || name === "help" || name === "--help" || name === "-h")
      return { out: help(), code: 0 };
    if (name === "commands") {
      const all = [...stuff.commands.values(), ...hostCommands].map(describe);
      return {
        out: opts.human
          ? human(all.map((c) => ({ title: `${c.name}: ${c.summary}` })))
          : JSON.stringify({ ok: true, result: { commands: all, globals: GLOBAL } }, null, 2),
        code: 0,
      };
    }
    const host = hostCommands.find((c) => c.name === name);
    const cmd = stuff.commands.get(name);
    if (!host && !cmd) throw new Error(`Unknown command "${name}"; try \`stuff commands\``);
    const parsed = parseArgs({ ...(host ?? cmd)!, run: () => ({}) }, args);
    const store = openStore(opts.db ?? env.STUFF_DB ?? defaultDb(env));
    try {
      if (name === "export") {
        const exporter = stuff.exporters.get((parsed.format as string) ?? "json")!;
        return { out: exporter.run(store.load()), code: 0 };
      }
      return store.transaction(() => {
        const docs = new Map(store.load().map((d) => [d.id, d]));
        const clock = hlc(randomId().slice(0, 8), () => now);
        for (const d of docs.values()) for (const s of Object.values(d.f)) clock.observe(s.c);
        const ctx: Ctx = {
          docs,
          clock,
          id: randomId,
          now,
          today: env.STUFF_TODAY ?? dayOf(new Date(now)),
        };
        let changed: Doc[];
        let result: unknown;
        if (name === "import") {
          const importer = stuff.importers.get((parsed.format as string) ?? "json")!;
          changed = importer.op(readFileSync(parsed.file as string, "utf8"))(ctx);
          result = { imported: changed.length };
        } else ({ docs: changed = [], result } = cmd!.run(ctx, parsed));
        if (changed.length) store.save(changed, true);
        return { out: print(result), code: 0 };
      });
    } finally {
      store.close();
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { out: opts.human ? `stuff: ${error}` : JSON.stringify({ ok: false, error }), code: 1 };
  }
}
