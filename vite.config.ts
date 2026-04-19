import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es" as const,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Strip modulepreload hints for huge, genuinely-lazy chunks (Monaco, HLS).
    // Browser still fetches them when dynamic import() runs — we just skip the
    // idle pre-fetch so initial page doesn't spend bandwidth on unused code.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter((d) => !d.includes("vendor-monaco") && !d.includes("vendor-hls")),
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");

          if (normalized.includes("/node_modules/")) {
            if (
              normalized.includes("/react/") ||
              normalized.includes("/react-dom/") ||
              normalized.includes("/scheduler/") ||
              normalized.includes("/react-i18next/") ||
              normalized.includes("/i18next/")
            ) {
              return "vendor-react";
            }
            if (normalized.includes("/@tauri-apps/")) {
              return "vendor-tauri";
            }
            if (normalized.includes("/framer-motion/") || normalized.includes("/motion-dom/") || normalized.includes("/motion-utils/")) {
              return "vendor-motion";
            }
            if (normalized.includes("/@monaco-editor/") || normalized.includes("/monaco-editor/")) {
              return "vendor-monaco";
            }
            if (normalized.includes("/hls.js/")) {
              return "vendor-hls";
            }
            return undefined;
          }

          return undefined;
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 5420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? { protocol: "ws", host, port: 5421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
