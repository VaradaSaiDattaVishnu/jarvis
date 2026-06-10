// Embedding service — local vector embeddings via @xenova/transformers
// Uses all-MiniLM-L6-v2 (384 dimensions, ~50MB, runs fully offline)

let pipeline = null;

class EmbeddingService {
  constructor() {
    this.extractor = null;
    this.ready = false;
    this._loading = null;
  }

  // Lazy-load the model on first use
  async init() {
    if (this.ready) return;
    if (this._loading) return this._loading;

    this._loading = (async () => {
      console.log('🔄 Loading embedding model...');
      if (!pipeline) {
        const transformers = await import('@xenova/transformers');
        // Use a stable on-disk cache dir so the model can be pre-baked into the
        // Docker image at build time and reused at runtime (no ~50MB cold-start
        // download). Falls back to the library default for local dev.
        if (process.env.TRANSFORMERS_CACHE) transformers.env.cacheDir = process.env.TRANSFORMERS_CACHE;
        pipeline = transformers.pipeline;
      }
      this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      this.ready = true;
      console.log('✅ Embedding model loaded');
    })();

    return this._loading;
  }

  // Generate embedding for a text string
  // Returns Float32Array of 384 dimensions
  async embed(text) {
    await this.init();
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  // Cosine similarity between two embedding vectors
  cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Rank candidates by semantic similarity to a query
  // candidates: [{ id, content, embedding, ...otherFields }]
  // Returns sorted array with similarity scores
  semanticSearch(queryEmbedding, candidates, topK = 5, threshold = 0.3) {
    const scored = candidates
      .map(c => ({
        ...c,
        similarity: this.cosineSimilarity(queryEmbedding, c.embedding),
      }))
      .filter(c => c.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  // Serialize embedding for SQLite BLOB storage
  static toBuffer(embedding) {
    return Buffer.from(new Float32Array(embedding).buffer);
  }

  // Deserialize embedding from SQLite BLOB
  static fromBuffer(buffer) {
    return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4));
  }
}

module.exports = EmbeddingService;
