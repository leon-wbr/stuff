import { describe, expect, it } from "vitest";
import { worldOf } from "./lists";
import { DEFAULTS, type Item } from "./model";
import { search } from "./search";

const w = worldOf([
  { ...DEFAULTS.project, id: "p", type: "project", title: "Garden shed" },
  { ...DEFAULTS.todo, id: "t1", type: "todo", title: "Buy seeds", notes: "for the garden" },
  { ...DEFAULTS.todo, id: "t2", type: "todo", title: "Gardening gloves", status: "completed" },
  { ...DEFAULTS.tag, id: "g", type: "tag", title: "Errand" },
] as Item[]);

describe("quick find", () => {
  it("ranks lists and projects above open to-dos, then finished ones", () => {
    expect(search(w, "gard").map((h) => h.id)).toEqual(["p", "t1", "t2"]);
  });

  it("finds built-in lists and tags, ignoring case and accents", () => {
    expect(search(w, "TODÁY")[0]).toEqual({ kind: "list", id: "today", title: "Today" });
    expect(search(w, "err")[0]).toMatchObject({ kind: "tag", id: "g" });
    expect(search(w, "  ")).toEqual([]);
  });
});
