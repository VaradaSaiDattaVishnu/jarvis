import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText } from "./chunk";
import { embed } from "./embeddings";
import { addChunk, countChunks, removeSource } from "./store";

// Documents live in server/data/documents/ (gitignored). Path is resolved
// relative to this file so `npm run ingest` works from anywhere.
const here = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(here, "..", "..", "data", "documents");

/**
 * Ingestion pipeline: for each .txt/.md file → chunk → embed each chunk → store.
 * Run with `npm run ingest`. Re-running replaces a file's chunks (idempotent).
 */
async function main() {
  let files: string[];
  try {
    files = readdirSync(DOCS_DIR).filter((f) => /\.(txt|md)$/i.test(f));
  } catch {
    console.error(`No documents folder at ${DOCS_DIR}. Create it, add .txt/.md files, and re-run.`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("No .txt/.md files to ingest. Drop some documents in data/documents/ and re-run.");
    return;
  }

  for (const file of files) {
    const text = readFileSync(join(DOCS_DIR, file), "utf8");
    const chunks = chunkText(text);
    console.log(`Ingesting ${file} → ${chunks.length} chunk(s)...`);

    removeSource(file); // replace any previous version of this file
    for (const chunk of chunks) {
      const vector = await embed(chunk);
      addChunk(file, chunk, vector);
    }
  }

  console.log(`Done. The knowledge base now holds ${countChunks()} chunk(s).`);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
