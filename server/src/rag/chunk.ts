/**
 * Split text into overlapping fixed-size chunks.
 *
 * Why chunk at all? Embeddings capture meaning best over a focused passage, and
 * we want to retrieve just the relevant slice of a document, not the whole file.
 * The OVERLAP keeps a thought from being cut cleanly in half at a boundary —
 * the sentence that straddles two chunks appears (whole) in at least one.
 *
 * This is character-based for simplicity; token-based or sentence-aware
 * ("semantic") chunking is the more advanced alternative.
 */
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + size, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap; // step forward, leaving `overlap` chars of context
  }
  return chunks;
}
