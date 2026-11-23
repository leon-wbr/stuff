import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { update } from "@stuff/core/doc";
import { hlc } from "@stuff/core/hlc";
import { stuff } from "@stuff/core/extensions";
import { defaultDb, run } from "./cli";
import { openStore } from "./store";

let dir: string;
let db: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stuff-cli-"));
  db = join(dir, "stuff.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const NOW = new Date("2026-11-23T10:00:00").getTime();
const stuffCli = (...argv: string[]) => {
  const { out, code } = run([...argv, "--db", db], {}, NOW);
  const parsed = argv.includes("--human") || argv[0] === "export" ? out : JSON.parse(out);
  return { out: parsed, code };
};

describe("stuff CLI", () => {
  it("adds, lists, shows and completes to-dos with JSON output", () => {
    stuffCli("add", "Kitchen", "--type", "project");
    const added = stuffCli(
      "add",
      "Buy bulbs",
      "--when",
      "today",
      "--project",
      "kitchen",
      "--checklist",
      "E27",
    );
    expect(added).toMatchObject({ code: 0, out: { ok: true, result: { title: "Buy bulbs" } } });
    const id = added.out.result.id as string;

    const today = stuffCli("list", "today").out.result;
    expect(today.sections[0].items.map((i: { title: string }) => i.title)).toEqual(["Buy bulbs"]);
    expect(stuffCli("show", id.slice(0, 8)).out.result.checklist).toMatchObject([{ title: "E27" }]);

    stuffCli("complete", id);
    expect(stuffCli("show", id).out.result.status).toBe("completed");
  });

  it("writes dirty documents through the store, so the app syncs them", () => {
    stuffCli("add", "Call the plumber");
    const store = openStore(db);
    expect(store.dirty().map((r) => r.doc.f.title?.v)).toEqual(["Call the plumber"]);
    store.close();
  });

  it("prints short text with --human and errors as JSON with exit code 1", () => {
    stuffCli("add", "Water the plants", "--when", "evening");
    expect(stuffCli("list", "today", "--human").out).toMatch(
      /^This Evening:\n {2}○ Water the plants {2}when 2026-11-23 evening {2}\w{8}$/,
    );
    expect(stuffCli("show", "nothing")).toEqual({
      code: 1,
      out: { ok: false, error: 'Nothing matches "nothing"' },
    });
    expect(stuffCli("frobnicate").out.error).toMatch(/Unknown command/);
  });

  it("lists every command with its arguments", () => {
    const { result } = stuffCli("commands").out;
    const names = result.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual([...stuff.commands.keys(), "commands", "import", "export"]);
    expect(result.commands.find((c: { name: string }) => c.name === "add").args.when.type).toBe(
      "when",
    );
  });

  it("merges with what the app wrote in the meantime instead of overwriting it", () => {
    const { id } = stuffCli("add", "Milk").out.result;
    const app = openStore(db);
    const stale = app.load()[0]!;
    stuffCli("edit", id, "--notes", "2 litres");
    app.save(
      [
        update(
          stale,
          { title: "Oat milk" },
          hlc("app", () => NOW + 1000),
        ),
      ],
      true,
    );
    expect(stuffCli("show", id).out.result).toMatchObject({ title: "Oat milk", notes: "2 litres" });
    app.close();
  });

  it("lets a running app notice its writes", () => {
    const app = openStore(db);
    expect(app.externalChanges()).toEqual([]);
    stuffCli("add", "From the CLI");
    expect(app.externalChanges().map((d) => d.f.title?.v)).toEqual(["From the CLI"]);
    expect(app.externalChanges()).toEqual([]);
    app.close();
  });

  it("exports a backup and imports it into another store", () => {
    stuffCli("add", "Keep me");
    const file = join(dir, "backup.json");
    writeFileSync(file, stuffCli("export").out);
    db = join(dir, "other.sqlite");
    expect(stuffCli("import", file).out.result).toEqual({ imported: 1 });
    expect(stuffCli("search", "keep").out.result[0]).toMatchObject({ title: "Keep me" });
  });

  it("finds the app's store per profile", () => {
    expect(defaultDb({ HOME: "/Users/x" })).toBe(
      "/Users/x/Library/Application Support/app.stuff.desktop/stuff.sqlite",
    );
    expect(defaultDb({ HOME: "/Users/x", STUFF_PROFILE: "a" })).toBe(
      "/Users/x/Library/Application Support/app.stuff.desktop/a/stuff.sqlite",
    );
  });
});
