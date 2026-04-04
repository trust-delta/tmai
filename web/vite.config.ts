/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  build: {
    outDir: "../src/web/assets",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:9876",
      "/hooks": "http://localhost:9876",
    },
  },
});
