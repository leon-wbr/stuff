import type { Doc } from "@stuff/core/doc";
import { seed } from "./seed.ts";

/**
 * Stands in for the Rust host so the real frontend runs in a plain browser tab: an in-memory
 * store seeded with synthetic data, events looped back, and no key (so no sync).
 * Imported before anything that touches @tauri-apps/api.
 */
const params = new URLSearchParams(location.search);
const store = new Map<string, Doc>(
  seed(params.get("mode") === "dark" ? "dark" : "light").map((d) => [d.id, d]),
);
const callbacks = new Map<number, (event: unknown) => void>();
const listeners: Record<string, number[]> = {};
let next = 1;

type Args = Record<string, unknown> & { event?: string; handler?: number; docs?: Doc[] };

Object.assign(window, {
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
  __TAURI_INTERNALS__: {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback: (cb: (event: unknown) => void) => (callbacks.set(next, cb), next++),
    unregisterCallback: (id: number) => callbacks.delete(id),
    invoke: async (cmd: string, args: Args = {}) => {
      if (cmd === "plugin:event|listen") {
        (listeners[args.event!] ??= []).push(args.handler!);
        return args.handler;
      }
      if (cmd === "store_load") return [...store.values()];
      if (cmd === "store_save") {
        for (const doc of args.docs!) store.set(doc.id, doc);
        setTimeout(() =>
          (listeners["store-changed"] ?? []).forEach((id) =>
            callbacks.get(id)?.({ event: "store-changed", id, payload: { docs: args.docs } }),
          ),
        );
      }
      return null;
    },
  },
});
