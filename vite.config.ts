import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// A interface mora em interface/. O Tauri abre o servidor de desenvolvimento na porta fixa
// do devUrl (src-tauri/tauri.conf.json) e empacota o dist/ da raiz (frontendDist).
export default defineConfig({
  root: "interface",
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "../dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Datas formatadas sempre no mesmo fuso, em qualquer máquina.
    env: { TZ: "UTC" },
  },
});
