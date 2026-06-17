// J.A.R.V.I.S — Retrieval-Augmented Generation over user documents (LangChain.js)
//
// Upload documents → split → embed (local all-MiniLM-L6-v2) → vector search.
// Powers the `search_documents` / `list_documents` / `read_document` agent tools
// and the Documents UI, giving JARVIS grounded, cited answers about the user's
// own files.
//
// Built on LangChain.js for the pipeline that was previously hand-rolled:
//   • RecursiveCharacterTextSplitter — smarter, well-tested chunking.
//   • MiniLMEmbeddings — a thin LangChain Embeddings adapter over the existing
//     @xenova/transformers MiniLM model (reuses the already-cached model, so no
//     new download and no version conflict with the rest of the app).
//   • MemoryVectorStore — an in-RAM cosine index used as the live retriever.
//
// Persistence stays in SQLite (source of truth): documents + their chunk vectors
// are stored as BLOBs and re-hydrated into the MemoryVectorStore on first use, so
// the knowledge base survives restarts. New uploads are embedded ONCE and written
// to both SQLite and the live index. (The previous version could store NULL
// embeddings when the model wasn't ready yet — those chunks became permanently
// invisible to semantic search; we now always embed, and backfill any legacy
// NULL rows on hydrate.)

const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { Embeddings } = require('@langchain/core/embeddings');
const { Document } = require('@langchain/core/documents');
const EmbeddingService = require('./embeddings');

const CHUNK_TARGET = 900;   // approx chars per chunk
const CHUNK_OVERLAP = 150;  // chars of overlap between chunks
const MAX_DOC_CHARS = 500000;

// ─── LangChain Embeddings adapter over the local MiniLM model ───────────
// Implements the two methods every LangChain vector store needs. Delegates to
// the shared EmbeddingService (which lazy-loads + caches the MiniLM model), so
// memory search and document RAG share one model instance.
class MiniLMEmbeddings extends Embeddings {
  constructor(embeddingService) {
    super({});
    this.svc = embeddingService;
  }
  async embedDocuments(texts) {
    const out = [];
    for (const t of texts) out.push(await this.svc.embed(t));
    return out;
  }
  async embedQuery(text) {
    return this.svc.embed(text);
  }
}

class RAGService {
  constructor({ memoryService }) {
    this.memory = memoryService;
    this.db = memoryService.db;
    this.embeddingService = memoryService.embeddings; // shared @xenova model
    this.embeddings = new MiniLMEmbeddings(this.embeddingService);
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this._ready = null; // promise guard for one-time hydrate
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source TEXT,
        content TEXT,
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
    // Migration: older DBs created `documents` without a `content` column. Add it
    // so read_document can return clean full text (best effort).
    try { this.db.exec('ALTER TABLE documents ADD COLUMN content TEXT'); } catch { /* already exists */ }

    this._insertDoc = this.db.prepare(
      'INSERT INTO documents (title, source, content, char_count, chunk_count) VALUES (?, ?, ?, ?, ?)'
    );
    this._insertChunk = this.db.prepare(
      'INSERT INTO doc_chunks (doc_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?)'
    );
  }

  // ─── One-time hydrate: load persisted vectors into the live index ──────
  async _ensureReady() {
    if (!this._ready) this._ready = this._hydrate();
    return this._ready;
  }

  async _hydrate() {
    await this.embeddingService.init(); // make sure the model is loaded for queries

    const rows = this.db.prepare(
      `SELECT c.content, c.embedding, c.doc_id, d.title
       FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
       WHERE c.embedding IS NOT NULL`
    ).all();
    if (rows.length) {
      const vectors = rows.map(r => EmbeddingService.fromBuffer(r.embedding));
      const docs = rows.map(r => new Document({ pageContent: r.content, metadata: { docId: r.doc_id, title: r.title } }));
      await this.vectorStore.addVectors(vectors, docs);
      console.log(`📚 RAG: hydrated ${rows.length} chunk(s) into the vector index`);
    }

    // Backfill any legacy NULL-embedding chunks (the old "invisible doc" bug).
    const missing = this.db.prepare(
      `SELECT c.id, c.content, c.doc_id, d.title
       FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
       WHERE c.embedding IS NULL`
    ).all();
    if (missing.length) {
      console.log(`🔄 RAG: backfilling embeddings for ${missing.length} legacy chunk(s)...`);
      const update = this.db.prepare('UPDATE doc_chunks SET embedding = ? WHERE id = ?');
      for (const r of missing) {
        try {
          const v = await this.embeddingService.embed(r.content);
          update.run(EmbeddingService.toBuffer(v), r.id);
          await this.vectorStore.addVectors([v], [new Document({ pageContent: r.content, metadata: { docId: r.doc_id, title: r.title } })]);
        } catch (e) { console.error('RAG backfill failed for chunk', r.id, e.message); }
      }
    }
  }

  // ─── Add a document ─────────────────────────────────────
  async addDocument(title, text, source = 'upload') {
    if (!text || !text.trim()) throw new Error('Document is empty');
    await this._ensureReady();

    const body = text.slice(0, MAX_DOC_CHARS);
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: CHUNK_TARGET, chunkOverlap: CHUNK_OVERLAP });
    const chunks = await splitter.splitText(body);
    if (chunks.length === 0) throw new Error('Document produced no chunks');

    // Embed every chunk up front (one pass) — never store NULL vectors.
    const vectors = await this.embeddings.embedDocuments(chunks);

    const cleanTitle = title.slice(0, 200);
    const insertAll = this.db.transaction(() => {
      const docId = this._insertDoc.run(cleanTitle, source, body, body.length, chunks.length).lastInsertRowid;
      chunks.forEach((c, idx) => this._insertChunk.run(docId, idx, c, EmbeddingService.toBuffer(vectors[idx])));
      return docId;
    });
    const docId = insertAll();

    // Add to the live index too (so it's searchable immediately, no restart).
    const docs = chunks.map((c, i) => new Document({ pageContent: c, metadata: { docId, title: cleanTitle, chunkIndex: i } }));
    await this.vectorStore.addVectors(vectors, docs);

    console.log(`📄 Indexed document "${cleanTitle}" → ${chunks.length} chunks (id ${docId})`);
    return { id: docId, title: cleanTitle, chunks: chunks.length, chars: body.length };
  }

  // ─── Hybrid search across all chunks ────────────────────
  // Semantic (vector) results are merged with keyword (LIKE) matches so an exact
  // phrase that the embedding ranks low still surfaces.
  async search(query, topK = 5) {
    if (!query || !query.trim()) return [];
    await this._ensureReady();

    const results = [];
    const seen = new Set();
    const key = r => `${r.docId}:${(r.content || '').slice(0, 40)}`;

    // 1) Semantic via the LangChain retriever
    try {
      const hits = await this.vectorStore.similaritySearchWithScore(query, topK);
      for (const [doc, score] of hits) {
        const r = { docId: doc.metadata.docId, title: doc.metadata.title, content: doc.pageContent, similarity: score };
        if (!seen.has(key(r))) { results.push(r); seen.add(key(r)); }
      }
    } catch (e) {
      console.error('RAG semantic search failed, using keyword only:', e.message);
    }

    // 2) Keyword supplement — catch exact matches the vector index ranked low.
    if (results.length < topK) {
      const like = `%${query.replace(/[%_]/g, '')}%`;
      const kw = this.db.prepare(
        `SELECT c.content, d.title, c.doc_id as docId
         FROM doc_chunks c JOIN documents d ON d.id = c.doc_id
         WHERE c.content LIKE ? LIMIT ?`
      ).all(like, topK);
      for (const r of kw) {
        if (results.length >= topK) break;
        const rr = { ...r, similarity: null };
        if (!seen.has(key(rr))) { results.push(rr); seen.add(key(rr)); }
      }
    }

    return results.slice(0, topK);
  }

  // Format retrieved chunks as grounded context for the LLM (with citations).
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

  // Full document text — for summarization / "read my whole doc" questions that
  // top-k retrieval can't serve. Prefers the stored full text; falls back to
  // re-joining chunks for legacy docs that predate the `content` column.
  getDocument(idOrTitle) {
    let doc = null;
    if (typeof idOrTitle === 'number' || /^\d+$/.test(String(idOrTitle))) {
      doc = this.db.prepare('SELECT id, title, content FROM documents WHERE id = ?').get(parseInt(idOrTitle, 10));
    }
    if (!doc && typeof idOrTitle === 'string') {
      doc = this.db.prepare('SELECT id, title, content FROM documents WHERE title LIKE ? ORDER BY created_at DESC LIMIT 1').get(`%${idOrTitle}%`);
    }
    if (!doc) return null;
    let content = doc.content;
    if (!content) {
      const chunks = this.db.prepare('SELECT content FROM doc_chunks WHERE doc_id = ? ORDER BY chunk_index').all(doc.id);
      content = chunks.map(c => c.content).join('\n\n');
    }
    return { id: doc.id, title: doc.title, content };
  }

  deleteDocument(id) {
    this.db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?').run(id);
    this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    // Rebuild the in-memory index from SQLite so the deleted doc stops matching.
    this.vectorStore = new MemoryVectorStore(this.embeddings);
    this._ready = null;
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
