import { defineConfig } from "vite";
import { resolve } from "node:path";

// Content scripts cannot be ES modules: bundle as a single IIFE.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/index.ts"),
      name: "KairoContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
