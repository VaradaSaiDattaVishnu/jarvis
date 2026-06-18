import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward API calls to the backend so the frontend can use relative
    // URLs (e.g. fetch("/chat")) — no CORS to configure. In production the same
    // relative URLs work because Express serves this app on the same origin.
    proxy: {
      "/chat": "http://localhost:3001",
      "/transcribe": "http://localhost:3001",
      "/health": "http://localhost:3001",
    },
  },
});
