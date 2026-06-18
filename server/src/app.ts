import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { healthRouter } from "./routes/health";
import { chatRouter } from "./routes/chat";
import { transcribeRouter } from "./routes/transcribe";
import { documentsRouter } from "./routes/documents";

/**
 * Build and configure the Express application.
 *
 * Deliberately separate from `index.ts` (which starts the server) so the app can
 * be imported in tests without binding a network port.
 */
export function buildApp() {
  const app = express();

  // Parse JSON bodies for the chat API. (The /transcribe and /documents routes
  // opt into raw body parsers of their own, since they receive binary audio and
  // raw file bytes respectively, not JSON.)
  app.use(express.json());

  // --- API routes (matched first, in order) ---
  app.use("/health", healthRouter);
  app.use("/chat", chatRouter);
  app.use("/transcribe", transcribeRouter);
  app.use("/documents", documentsRouter);

  // --- Production: serve the built React app on the SAME origin as the API ---
  // One service hosts everything, so there's no CORS and the frontend's relative
  // fetch("/chat") calls just work. We serve whenever a build exists; in dev you
  // use the Vite dev server (:5173) instead and this branch is skipped.
  const here = dirname(fileURLToPath(import.meta.url)); // server/src
  const webDist = join(here, "..", "..", "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    // SPA fallback: any non-API GET returns index.html (single-page app).
    app.get("*", (_req, res) => res.sendFile(join(webDist, "index.html")));
  }

  return app;
}
