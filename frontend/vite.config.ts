import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API runs separately; /api is proxied so the browser sees one origin.
const here = fileURLToPath(new URL(".", import.meta.url));
const backend = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;

// Two pages from one codebase: the site (index.html) and the control centre (admin.html),
// which runs on its own host and shares the design system.
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": { target: backend, changeOrigin: false }, "/health": backend },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { input: { site: resolve(here, "index.html"), control: resolve(here, "admin.html") } },
  },
});
