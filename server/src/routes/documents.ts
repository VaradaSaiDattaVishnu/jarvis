import { Router, raw } from "express";
import { chunkText } from "../rag/chunk";
import { embed } from "../rag/embeddings";
import { addChunk, listSources, removeSource } from "../rag/store";

export const documentsRouter = Router();

/**
 * POST /documents   ?filename=<name.txt|name.md>   body: raw file bytes
 *     ->   { "source": "...", "chunks": <n> }
 * GET  /documents   ->   { "documents": [{ "source": "...", "chunks": <n> }, ...] }
 *
 * The UI-driven twin of `npm run ingest`: it does the SAME chunk → embed → store
 * work, but on bytes uploaded over HTTP instead of files read off disk. Ingestion
 * is SYNCHRONOUS — we embed every chunk inside the request and return the count —
 * which is fine because MiniLM runs locally and we cap uploads at 5mb of text.
 * Nothing touches disk: the upload goes straight into SQLite.
 *
 * Once stored, these chunks are immediately searchable by the agent's
 * `document_search` tool — no separate index step.
 */

/**
 * Like /transcribe, this route opts into a raw body parser instead of the global
 * `express.json()`. We're receiving arbitrary file bytes (a .txt or .md), not
 * JSON, and `express.json()` would either choke on or silently mangle that body.
 * `type: () => true` means "treat the body as raw for ANY content-type"; the JSON
 * parser still handles every OTHER route as before.
 *
 * No API key / 503 dance is needed here (unlike /transcribe): embeddings come from
 * a local MiniLM model, so there's nothing to misconfigure.
 */
documentsRouter.post("/", raw({ type: () => true, limit: "5mb" }), async (req, res) => {
  // The filename arrives as a query param so the body stays purely file bytes.
  // We only accept plain-text formats — anything else (PDF, docx, ...) would need
  // its own extraction step before chunking, which this endpoint deliberately omits.
  const filename = req.query.filename;
  if (typeof filename !== "string" || !/\.(txt|md)$/i.test(filename)) {
    res.status(400).json({ error: "Provide ?filename= ending in .txt or .md" });
    return;
  }

  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    res.status(400).json({ error: "Request body must be non-empty file bytes." });
    return;
  }

  const text = buf.toString("utf8");
  const chunks = chunkText(text);
  if (chunks.length === 0) {
    res.status(400).json({ error: "File appears to be empty." });
    return;
  }

  // The try/catch matters: Express 4 does NOT catch errors thrown from async
  // handlers, so a failed embed/store would crash the request instead of returning
  // a clean 500. (Same reasoning as /chat and /transcribe.)
  try {
    // Drop any previous version of this filename first, so re-uploading the same
    // name REPLACES rather than duplicates — exactly what `npm run ingest` does.
    removeSource(filename);
    for (const chunk of chunks) {
      addChunk(filename, chunk, await embed(chunk));
    }
    res.json({ source: filename, chunks: chunks.length });
  } catch (err) {
    console.error("Ingestion error:", err);
    res.status(500).json({ error: "Ingestion failed." });
  }
});

/**
 * List what's in the knowledge base. Small and synchronous — a single grouped
 * read — so there's no async work to guard. A failing better-sqlite3 read is
 * exceptional (a broken DB), and letting it surface is the honest outcome.
 */
documentsRouter.get("/", (_req, res) => {
  res.json({ documents: listSources() });
});
