import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Solana libraries assume Node globals, so the browser build needs them shimmed.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  resolve: {
    alias: { buffer: "buffer/" },
  },
  server: {
    port: 5174,
    // Mirrors the production layout, where /api is served by the Vercel
    // functions sitting beside the app.
    proxy: { "/api": "http://localhost:8787" },
  },
});
