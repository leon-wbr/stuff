import { describe, expect, it } from "vitest";
import { enabledRelays, normalizeRelay } from "./relays";

describe("relay settings", () => {
  it("normalizes relay addresses and allows plain ws only on this Mac", () => {
    expect(normalizeRelay("relay.example.com/")).toBe("wss://relay.example.com");
    expect(normalizeRelay("ws://localhost:7777")).toBe("ws://localhost:7777");
    expect(normalizeRelay("ws://relay.example.com")).toBeUndefined();
    expect(normalizeRelay("https://relay.example.com")).toBeUndefined();
    expect(normalizeRelay(" ")).toBeUndefined();
  });

  it("falls back to the defaults until the user sets relays", () => {
    expect(enabledRelays(null)).toHaveLength(3);
    expect(
      enabledRelays([
        { url: "wss://a", enabled: true },
        { url: "wss://b", enabled: false },
      ]),
    ).toEqual(["wss://a"]);
  });
});
