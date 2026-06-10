// J.A.R.V.I.S — Retrieval-Augmented Generation over user documents
//
// Upload documents → chunk → embed (local all-MiniLM-L6-v2) → vector search.
// Powers the `search_documents` agent tool and the Documents UI, giving JARVIS
// grounded, cited answers about the user's own files.

const EmbeddingService = require('./embeddings');

const CHUNK_TARGET = 900;   // approx chars per chunk
const CHUNK_OVERLAP = 150;  // chars of overlap between chunks
const MAX_DOC_CHARS = 500000;

class RAGService {
  constructor({ memoryService }) {
    this.memory = memoryService;
    this.db = memoryService.db;
    this.embeddings = memoryService.embeddings;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source TEXT,
        char_count INTEGER DEFAULT 0,
        chunk_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS doc_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_id);
    `);

    this._insertDoc = this.db.prepare(
      'INSERT INTO documents (title, source, char_count, chunk_count) VALUES (?, ?, ?, ?)'
    );
    this._insertChunk = this.db.prepare(
      'INSERT INTO doc_chunks (doc_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?)'
    );
  }

  // ─── Chunking ───────────────────────────────────────────
  _chunk(text) {
    const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!clean) return [];
    const chunks = [];
    let i = 0;
    while (i < clean.length) {
      let end = Math.min(i + CHUNK_TARGET, clean.length);
      // Prefer to break on a paragraph or sentence boundary near the target
      if (end < clean.length) {
        const slice = clean.slice(i, end);
        const para = slice.lastIndexOf('\n\n');
        const sent = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
        const breakAt = para > CHUNK_TARGET * 0.5 ? para : (sent > CHUNK_TARGET * 0.5 ? sent + 1 : -1);
        if (breakAt > 0) end = i + breakAt;
      }
      const piece = clean.slice(i, end).trim();
      if (piece) chunks.push(piece);
      if (end >= clean.length) break;
      i = Math.max(end - CHUNK_OVERLAP, i + 1);
    }
    return chunks;
  }

  // ─── Add a document ─────────────────────────────────────
  async addDocument(title, text, source = 'upload') {
    if (!text || !text.trim()) throw new Error('Document is empty');
    const body = text.slice(0, MAX_DOC_CHARS);
    const chunks = this._chunk(body);
    if (chunks.length === 0) throw new Error('Document produced no chunks');

    // Ensure embeddings are loaded (best effort)
    if (!this.embeddings.ready) {
      try { await this.embeddings.init(); } catch { /* fall back to keyword search */ }
    }

    const insertAll = this.db.transaction((docTitle, src, charCount, pieces, vectors) => {
      const docId = this._insertDoc.run(docTitle, src, charCount, pieces.length).lastInsertRowid;
      pieces.forEach((c, idx) => {
        this._insertChunk.run(docId, idx, c, vectors[idx]);
      });
      return docId;
    });

    // Compute embeddings outside the transaction (async), then insert atomically.
    const vectors = [];
    for (const c of chunks) {
      let buf = null;
      if (this.embeddings.ready) {
        try { buf = EmbeddingService.toBuffer(await this.embeddings.embed(c)); } catch { /* keyword fallback */ }
      }
      vectors.push(buf);
    }

    const docId = insertAll(title.slice(0, 200), source, body.length, chunks, vectors);
    console.log(`📄 Indexed document "${title}" → ${chunks.length} chunks (id ${docId})`);
    return { id: docId, title, chunks: chunks.length, chars: body.length };
  }

  // ─── Hybrid search across all chunks ────────────────────
  // Semantic (cosine) results are merged with keyword (LIKE) matches so an exact
  // phrase that scores below the cosine threshold still surfaces — pure semantic
  // alone silently missed terms that are literally in the document.
  async search(query, topK = 5) {
    if (!query || !query.trim()) return [];

    const results = [];
    const seen = new Set();
    const key = r => `${r.docId}:${(r.content || '').slice(0, 40)}`;

    // 1) Semantic
    if (this.embeddings.ready) {
      try {
        const q = await this.embeddings.embed(query);
        const rows = this.db.prepare(
          `SELECT c.content, c.embedding, c.doc_id, d.title
           FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
           WHERE c.embedding IS NOT NULL`
        ).all();
        const scored = rows.map(r => ({
          docId: r.doc_id, title: r.title, content: r.content,
          similarity: this.embeddings.cosineSimilarity(q, EmbeddingService.fromBuffer(r.embedding)),
        })).filter(r => r.similarity >= 0.2).sort((a, b) => b.similarity - a.similarity);
        for (const r of scored.slice(0, topK)) { results.push(r); seen.add(key(r)); }
      } catch (e) {
        console.error('RAG semantic search failed, using keyword only:', e.message);
      }
    }

    // 2) Keyword — always run, to catch exact matches semantic ranked below threshold.
    if (results.length < topK) {
      const like = `%${query.replace(/[%_]/g, '')}%`;
      const kw = this.db.prepare(
        `SELECT c.content, d.title, c.doc_id as docId
         FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
         WHERE c.content LIKE ? LIMIT ?`
      ).all(like, topK);
      for (const r of kw) {
        if (results.length >= topK) break;
        if (!seen.has(key(r))) { results.push({ ...r, similarity: null }); seen.add(key(r)); }
      }
    }

    return results.slice(0, topK);
  }

  // Format retrieved chunks as grounded context for the LLM (with citations)
  formatForContext(results) {
    if (!results || results.length === 0) {
      return 'No relevant passages were found in the uploaded documents.';
    }
    return results.map((r, i) =>
      `[Source ${i + 1}: "${r.title}"]\n${r.content}`
    ).join('\n\n---\n\n');
  }

  listDocuments() {
    return this.db.prepare(
      'SELECT id, title, source, char_count, chunk_count, created_at FROM documents ORDER BY created_at DESC'
    ).all();
  }

  deleteDocument(id) {
    this.db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?').run(id);
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { success: true };
  }

  getStats() {
    const docs = this.db.prepare('SELECT COUNT(*) as c FROM documents').get().c;
    const chunks = this.db.prepare('SELECT COUNT(*) as c FROM doc_chunks').get().c;
    return { documents: docs, chunks };
  }

  setupRoutes(app, guard = (req, res, next) => next()) {
    app.get('/api/documents', (req, res) => {
      res.json({ documents: this.listDocuments(), stats: this.getStats() });
    });

    app.post('/api/documents', guard, async (req, res) => {
      const { title, content, source } = req.body || {};
      if (!content || !content.trim()) return res.status(400).json({ error: 'content required' });
      try {
        const result = await this.addDocument(title || 'Untitled', content, source || 'upload');
        res.json({ success: true, ...result });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    });

    app.post('/api/documents/search', async (req, res) => {
      const { query, topK } = req.body || {};
      if (!query) return res.status(400).json({ error: 'query required' });
      const results = await this.search(query, topK || 5);
      res.json({ results });
    });

    app.delete('/api/documents/:id', guard, (req, res) => {
      this.deleteDocument(parseInt(req.params.id));
      res.json({ success: true });
    });
  }
}

module.exports = RAGService;
