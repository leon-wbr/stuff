import { defineConfig } from "vitest/config";

/** Bundles the CLI and the core modules it uses into one Node script. */
export default defineConfig({
  build: {
    ssr: "src/main.ts",
    target: "node22",
    outDir: "dist",
    rollupOptions: { output: { entryFileNames: "stuff.mjs", banner: "#!/usr/bin/env node" } },
  },
  ssr: { noExternal: true },
  test: { include: ["src/**/*.test.ts"] },
});
