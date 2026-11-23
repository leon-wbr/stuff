import { describe, expect, it } from "vitest";
import { backupJson, restoreBackup } from "./backup";
import { create, materialize, update } from "./doc";
import { hlc } from "./hlc";
import type { Todo } from "./model";
import type { Ctx } from "./ops";

describe("JSON backup", () => {
  it("round-trips documents and keeps edits newer than the backup", () => {
    let t = 1;
    const clock = hlc("a", () => t);
    const a = create("todo", "a", { title: "A" }, clock);
    const b = create("todo", "b", { title: "B" }, clock);
    const text = backupJson([a, b]);
    t = 2;
    const ctx: Ctx = {
      docs: new Map([["a", update(a, { title: "A2" }, clock)]]),
      clock,
      id: () => "x",
      now: 0,
      today: "2026-11-23",
    };
    const restored = restoreBackup(text)(ctx);
    expect(restored.map((d) => [d.id, materialize<Todo>(d).title])).toEqual([["b", "B"]]);
  });

  it("refuses files that aren't stuff backups", () => {
    const ctx: Ctx = {
      docs: new Map(),
      clock: hlc("a"),
      id: () => "x",
      now: 0,
      today: "2026-11-23",
    };
    expect(() => restoreBackup("{}")(ctx)).toThrow("This isn't a stuff backup");
  });
});
