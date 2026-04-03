import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    target: "chrome120",
    modulePreload: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background/index.ts"),
        devtools: resolve(__dirname, "src/devtools/devtools.ts"),
        panel: resolve(__dirname, "src/devtools/panel.ts"),
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
        inlineDynamicImports: false,
      },
    },
  },
  plugins: [
    {
      name: "copy-extension-files",
      closeBundle() {
        copyFileSync("manifest.json", "dist/manifest.json");
        mkdirSync("dist/devtools", { recursive: true });
        copyFileSync("src/devtools/devtools.html", "dist/devtools/devtools.html");
        copyFileSync("src/devtools/panel.html", "dist/devtools/panel.html");
        mkdirSync("dist/public/icons", { recursive: true });
        copyFileSync("public/icons/icon16.png", "dist/public/icons/icon16.png");
        copyFileSync("public/icons/icon48.png", "dist/public/icons/icon48.png");
        copyFileSync("public/icons/icon128.png", "dist/public/icons/icon128.png");
      },
    },
  ],
});
