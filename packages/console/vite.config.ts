import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: { outDir: "../../dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    // The API server checks the Host header, so rewrite it.
    proxy: { "/api/": { target: "http://127.0.0.1:4870", changeOrigin: true } },
  },
});
