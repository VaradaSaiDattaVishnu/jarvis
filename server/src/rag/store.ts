import { db } from "../db";

export interface ScoredChunk {
  source: string;
  content: string;
  score: number;
}

/**
 * Cosine similarity between two vectors — the cosine of the angle between them,
 * from -1 (opposite) to 1 (identical direction). Our embeddings are normalised,
 * so this equals their dot product, but the full formula is clearer and robust.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Persist one chunk and its embedding. */
export function addChunk(source: string, content: string, embedding: number[]): void {
  db.prepare("INSERT INTO chunks (source, content, embedding) VALUES (?, ?, ?)").run(
    source,
    content,
    JSON.stringify(embedding),
  );
}

/** Forget every chunk from one source (so re-ingesting a file replaces it). */
export function removeSource(source: string): void {
  db.prepare("DELETE FROM chunks WHERE source = ?").run(source);
}

/**
 * Brute-force nearest-neighbour search: score EVERY chunk against the query and
 * return the top `k`. At personal-document scale (hundreds–thousands of chunks)
 * this is plenty fast, and you can see exactly what it does — no index, no magic.
 */
export function searchChunks(queryEmbedding: number[], k = 4): ScoredChunk[] {
  const rows = db.prepare("SELECT source, content, embedding FROM chunks").all() as Array<{
    source: string;
    content: string;
    embedding: string;
  }>;

  return rows
    .map((row) => ({
      source: row.source,
      content: row.content,
      score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** How many chunks are currently in the store. */
export function countChunks(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
  return row.n;
}

/**
 * List every source file we hold, with its chunk count — one row per document.
 * Powers the UI's "what's in the knowledge base?" view. We GROUP BY source so a
 * file ingested as 12 chunks shows up once (chunks: 12), not twelve times.
 */
export function listSources(): { source: string; chunks: number }[] {
  const rows = db
    .prepare("SELECT source, COUNT(*) AS chunks FROM chunks GROUP BY source ORDER BY source")
    .all() as Array<{ source: string; chunks: number }>;
  return rows;
}

/**
 * Every chunk of ONE source, in document order. Ordering by `id` (an autoincrement
 * primary key) reproduces ingest order, which is reading order — so joining these
 * back together reconstructs the original document for summarisation.
 */
export function getChunksBySource(source: string): string[] {
  const rows = db
    .prepare("SELECT content FROM chunks WHERE source = ? ORDER BY id")
    .all(source) as Array<{ content: string }>;
  return rows.map((row) => row.content);
}
