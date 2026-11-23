import { describe, expect, it } from "vitest";
import { adapterFor, builtins, parseSyncConfig, registry, stuff, type SyncEnv } from "./extensions";

const env: SyncEnv = {
  relays: () => ({ subscribe: () => () => {}, publish: async () => {}, check: async () => {} }),
  folder: () => ({
    list: async () => [],
    stat: async () => null,
    read: async () => "",
    write: async () => ({ mtime: 0, size: 0 }),
  }),
};

describe("extensions", () => {
  it("registers the built-ins: commands, sync adapters, importers and exporters", () => {
    expect([...stuff.commands.keys()]).toContain("add");
    expect([...stuff.syncAdapters.keys()]).toEqual(["nostr", "folder"]);
    expect([...stuff.importers.keys()]).toEqual(["json", "things"]);
    expect([...stuff.exporters.keys()]).toEqual(["json"]);
  });

  it("rejects two extensions claiming the same name", () => {
    expect(() =>
      registry([...builtins, { id: "mine", commands: [builtins[0]!.commands![0]!] }]),
    ).toThrow(/Two commands are named "list"/);
  });

  it("builds the adapter for this Mac's sync choice; Off is the default and needs no key", () => {
    expect(parseSyncConfig(null)).toEqual({ adapter: "off" });
    expect(adapterFor(stuff, { adapter: "off" }, env)).toBeUndefined();
    expect(() => adapterFor(stuff, { adapter: "nostr" }, env)).toThrow("Set up a key first");
    expect(() => adapterFor(stuff, { adapter: "folder" }, env)).toThrow("Choose a folder first");
    expect(adapterFor(stuff, { adapter: "folder", path: "/x" }, env)?.key).toBe("folder:/x");
    expect(() => adapterFor(stuff, { adapter: "folder", path: "/x", encrypt: true }, env)).toThrow(
      "Set up a key first",
    );
  });
});
