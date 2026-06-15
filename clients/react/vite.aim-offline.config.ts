// Build config for the OFFLINE aim mode (design-machine authoring).
//
// Identical to `vite.config.ts` except: the entry is `aim-offline.html`, and
// `@/lib/api` is aliased to the file-backed `api-files` so the unchanged
// aim-console components read/write a locally-picked `doc/aims/` directory
// instead of the HTTP engine. The exact-match regex alias is FIRST so it wins
// over the broad `@` prefix alias (a plain `@/lib/api` string alias would also
// rewrite `@/lib/api-http`, which `api-files` itself imports — the regex avoids
// that). Production's `vite.config.ts` is untouched.

import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/api$/,
        replacement: path.resolve(__dirname, "./src/lib/api-files.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  build: {
    outDir: "dist-aim-offline",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "aim-offline.html"),
    },
  },
  server: {
    port: 1421,
    strictPort: true,
  },
});
