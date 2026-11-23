import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Inlines the bundle into index.html as a classic script, so the page works opened as a
 * file:// URL (browsers refuse module scripts from file://).
 */
function singleFile(): Plugin {
  return {
    name: "single-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName.endsWith(".html"));
      if (html?.type !== "asset") return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          const code = file.code.replaceAll("</script", "<\\/script");
          page = page
            .replace(new RegExp(`<script[^>]*src="[^"]*${file.fileName}"[^>]*></script>`), "")
            .replace("</body>", () => `<script>${code}</script>\n</body>`);
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          page = page
            .replace(new RegExp(`<link[^>]*href="[^"]*${file.fileName}"[^>]*>`), "")
            .replace("</head>", () => `<style>${String(file.source)}</style>\n</head>`);
          delete bundle[name];
        }
      }
      html.source = page;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), singleFile()],
  clearScreen: false,
  build: {
    target: "es2022",
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.POSITIVE_INFINITY,
    rollupOptions: { output: { format: "iife" } },
  },
});
