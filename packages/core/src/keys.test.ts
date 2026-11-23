import { describe, expect, it } from "vitest";
import { combo, commandFor, startsTypeTravel } from "./keys";

const key = (
  k: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
  code?: string,
) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  code,
  ...mods,
});

describe("shortcuts", () => {
  it("maps Things' shortcuts to commands", () => {
    expect(commandFor(key("k", { metaKey: true }))).toBe("complete");
    expect(commandFor(key("t", { metaKey: true }))).toBe("today");
    expect(commandFor(key("e", { metaKey: true }))).toBe("evening");
    expect(commandFor(key("s", { metaKey: true }))).toBe("when");
    expect(commandFor(key("D", { metaKey: true, shiftKey: true }))).toBe("deadline");
    expect(commandFor(key("M", { metaKey: true, shiftKey: true }))).toBe("move");
    expect(commandFor(key("2", { metaKey: true }))).toBe("go:2");
  });

  it("reads the physical key when Alt changes the character", () => {
    expect(commandFor(key("˜", { metaKey: true, altKey: true }, "KeyN"))).toBe("newProject");
    expect(combo(key("!", { metaKey: true, shiftKey: true }, "Digit1"))).toBe("Mod+Shift+1");
  });

  it("starts Type Travel on a plain printable key only", () => {
    expect(startsTypeTravel(key("g"))).toBe(true);
    expect(startsTypeTravel(key("G", { shiftKey: true }))).toBe(true);
    expect(startsTypeTravel(key("g", { metaKey: true }))).toBe(false);
    expect(startsTypeTravel(key("ArrowUp"))).toBe(false);
    expect(startsTypeTravel(key(" "))).toBe(false);
  });
});
