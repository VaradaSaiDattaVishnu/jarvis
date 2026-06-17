const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const EmbeddingService = require('./embeddings');
const EncryptionService = require('./encryption');
const { formatDateTime } = require('./timeparser');

// ─── Consolidated post-turn extraction schema ───────────────────────────
// One typed structured-output call replaces the eight separate LLM calls that
// used to fire after every reply (memories, profile, relationships, tasks,
// preferences, entities, mood, follow-ups). Every field is optional/defaulted so
// the model can omit sections and the result still validates — partial output is
// fine, and one bad section never loses the others.
const EXTRACTION_SCHEMA = z.object({
  memories: z.array(z.object({
    category: z.enum(['fact', 'preference', 'event', 'relationship', 'emotion', 'routine']).default('fact'),
    content: z.string().describe('a concise standalone sentence about the user'),
    keywords: z.string().describe('comma-separated search terms'),
    importance: z.number().min(1).max(5).default(2).describe('5=name/identity, 4=life events, 3=preferences, 2=opinions, 1=minor'),
    expires: z.string().nullable().default(null).describe('ISO date if temporary (e.g. "on vacation until Fri"), else null'),
  })).default([]).describe('long-term facts worth remembering about the user; [] if none'),
  profile: z.object({
    name: z.string().optional(),
    job: z.string().optional(),
    location: z.string().optional(),
    interests: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    communication_style: z.string().optional(),
  }).default({}).describe('only NEW/changed profile fields from this exchange'),
  relationships: z.array(z.object({
    name: z.string(),
    relationship: z.string().nullable().default(null),
    context: z.string().nullable().default(null),
  })).default([]).describe('people mentioned; [] if none'),
  tasks: z.array(z.object({
    content: z.string(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
    due_date: z.string().nullable().default(null),
  })).default([]).describe('todos/commitments the user expressed ("I need to…", deadlines); [] if none'),
  preferences: z.array(z.object({
    category: z.string(),
    preference: z.string(),
    source: z.enum(['explicit', 'implicit']).default('implicit'),
    confidence: z.number().min(0).max(1).default(0.6),
  })).default([]).describe('user likes/dislikes; [] if none'),
  entities: z.array(z.object({
    name: z.string(),
    type: z.string().describe('person/place/organization/date/product/event'),
    attributes: z.string().nullable().default(null),
  })).default([]).describe('notable named entities; [] if none'),
  mood: z.object({
    mood: z.enum(['happy', 'sad', 'stressed', 'anxious', 'frustrated', 'excited', 'neutral', 'tired', 'angry', 'curious']).default('neutral'),
    intensity: z.number().min(0).max(1).default(0.3),
    triggers: z.string().default(''),
  }).default({ mood: 'neutral', intensity: 0.3, triggers: '' }).describe("the user's emotional tone in their message"),
  followUps: z.array(z.object({
    topic: z.string(),
    context: z.string().default(''),
    check_after_hours: z.number().min(1).max(336).default(24),
  })).default([]).describe('things worth checking in on later (events, decisions, health, interviews); [] if none'),
});

const EXTRACTION_SYSTEM = `You analyze one conversation exchange and extract structured information about the user to remember.
Capture the user's name/identity as a memory with importance 5 whenever they introduce themselves.
Only include profile fields that are NEW or changed in this exchange. Use empty arrays / "neutral" mood when a section has nothing.`;

// Persistent data dir (set DATA_DIR to a mounted volume in production so the
// SQLite DB survives redeploys). Falls back to the project root for local dev.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

class MemoryService {
  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
    }
    this.dataDir = DATA_DIR;
    this.db = new Database(path.join(DATA_DIR, 'jarvis_memory.db'));
    this.db.pragma('journal_mode = WAL');
    this.embeddings = new EmbeddingService();
    this.encryption = new EncryptionService();
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        keywords TEXT NOT NULL,
        importance INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS user_profile (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        trigger_time DATETIME NOT NULL,
        recurrence TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint TEXT UNIQUE NOT NULL,
        keys_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
      CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memories_keywords ON memories(keywords);
      CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status, trigger_time);

      -- Phase 4 tables
      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_name TEXT NOT NULL,
        relationship_type TEXT,
        context TEXT,
        first_mentioned DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_mentioned DATETIME DEFAULT CURRENT_TIMESTAMP,
        mention_count INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_rel_name ON relationships(person_name);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        topics TEXT,
        message_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        due_date DATETIME,
        calendar_event_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        preference TEXT NOT NULL,
        source TEXT DEFAULT 'explicit',
        confidence REAL DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reinforcement_count INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_preferences_cat ON preferences(category);

      CREATE TABLE IF NOT EXISTS routines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        type TEXT DEFAULT 'time',
        confidence REAL DEFAULT 0.5,
        evidence TEXT,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        attributes TEXT,
        first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        mention_count INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT NOT NULL,
        tags TEXT,
        embedding BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS follow_ups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT NOT NULL,
        context TEXT,
        check_after DATETIME NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_followup_status ON follow_ups(status, check_after);

      -- Persisted app/integration config (so admin-saved keys survive redeploys)
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrations for existing DBs
    const migrations = [
      'ALTER TABLE memories ADD COLUMN embedding BLOB',
      'ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0',
      'ALTER TABLE memories ADD COLUMN expires_at DATETIME',
      'ALTER TABLE tasks ADD COLUMN calendar_event_id TEXT',
    ];
    for (const sql of migrations) {
      try { this.db.exec(sql); } catch (e) { /* column already exists */ }
    }

    // Prepared statements for speed
    this._insertConv = this.db.prepare(
      'INSERT INTO conversations (session_id, role, content) VALUES (?, ?, ?)'
    );
    this._insertMemory = this.db.prepare(
      'INSERT INTO memories (category, content, keywords, importance, embedding) VALUES (?, ?, ?, ?, ?)'
    );
    this._upsertProfile = this.db.prepare(
      'INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );
    this._updateMemoryEmbedding = this.db.prepare(
      'UPDATE memories SET embedding = ? WHERE id = ?'
    );
    this._updateMemoryAccess = this.db.prepare(
      'UPDATE memories SET last_accessed = CURRENT_TIMESTAMP, access_count = access_count + 1 WHERE id = ?'
    );
    this._deleteMemory = this.db.prepare(
      'DELETE FROM memories WHERE id = ?'
    );
    this._updateMemoryContent = this.db.prepare(
      'UPDATE memories SET content = ?, keywords = ?, embedding = ?, last_accessed = CURRENT_TIMESTAMP WHERE id = ?'
    );

    // ─── Prepared statements for Phase 4 tables ───────────
    this._insertRelationship = this.db.prepare(
      'INSERT INTO relationships (person_name, relationship_type, context) VALUES (?, ?, ?)'
    );
    this._updateRelationship = this.db.prepare(
      `UPDATE relationships SET relationship_type = COALESCE(?, relationship_type),
       context = COALESCE(?, context), last_mentioned = CURRENT_TIMESTAMP,
       mention_count = mention_count + 1 WHERE id = ?`
    );
    this._findRelationship = this.db.prepare(
      'SELECT * FROM relationships WHERE LOWER(person_name) = LOWER(?)'
    );

    this._insertSummary = this.db.prepare(
      'INSERT INTO session_summaries (session_id, summary, topics, message_count) VALUES (?, ?, ?, ?)'
    );

    this._insertTask = this.db.prepare(
      'INSERT INTO tasks (content, status, priority, due_date) VALUES (?, ?, ?, ?)'
    );
    this._updateTaskStatus = this.db.prepare(
      `UPDATE tasks SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?`
    );

    this._insertPreference = this.db.prepare(
      'INSERT INTO preferences (category, preference, source, confidence) VALUES (?, ?, ?, ?)'
    );
    this._reinforcePreference = this.db.prepare(
      'UPDATE preferences SET confidence = MIN(1.0, confidence + 0.1), reinforcement_count = reinforcement_count + 1 WHERE id = ?'
    );
    this._findPreference = this.db.prepare(
      'SELECT * FROM preferences WHERE LOWER(category) = LOWER(?) AND LOWER(preference) = LOWER(?)'
    );

    this._insertRoutine = this.db.prepare(
      'INSERT INTO routines (pattern, type, confidence, evidence) VALUES (?, ?, ?, ?)'
    );

    this._insertEntity = this.db.prepare(
      'INSERT INTO entities (name, type, attributes) VALUES (?, ?, ?)'
    );
    this._updateEntity = this.db.prepare(
      'UPDATE entities SET attributes = ?, last_seen = CURRENT_TIMESTAMP, mention_count = mention_count + 1 WHERE id = ?'
    );
    this._findEntity = this.db.prepare(
      'SELECT * FROM entities WHERE LOWER(name) = LOWER(?) AND type = ?'
    );

    this._insertNote = this.db.prepare(
      'INSERT INTO notes (title, content, tags, embedding) VALUES (?, ?, ?, ?)'
    );
    this._deleteNote = this.db.prepare('DELETE FROM notes WHERE id = ?');

    this._insertFollowUp = this.db.prepare(
      'INSERT INTO follow_ups (topic, context, check_after) VALUES (?, ?, ?)'
    );
    this._updateFollowUpStatus = this.db.prepare(
      'UPDATE follow_ups SET status = ? WHERE id = ?'
    );
  }

  // ─── Embedding Initialization ───────────────────────────
  async initEmbeddings() {
    await this.embeddings.init();
    await this._backfillEmbeddings();
  }

  async _backfillEmbeddings() {
    const missing = this.db.prepare(
      'SELECT id, content FROM memories WHERE embedding IS NULL'
    ).all();

    if (missing.length === 0) return;
    console.log(`🔄 Backfilling embeddings for ${missing.length} existing memories...`);

    for (const mem of missing) {
      try {
        const embedding = await this.embeddings.embed(mem.content);
        this._updateMemoryEmbedding.run(EmbeddingService.toBuffer(embedding), mem.id);
      } catch (e) {
        console.error(`Failed to embed memory ${mem.id}:`, e.message);
      }
    }
    console.log('✅ Embedding backfill complete');
  }

  // ─── Conversation Storage ──────────────────────────────
  saveMessage(sessionId, role, content) {
    // Encrypt user messages for privacy
    const stored = role === 'user' ? this.encryption.encrypt(content) : content;
    this._insertConv.run(sessionId, role, stored);
  }

  getRecentMessages(sessionId, limit = 20) {
    const rows = this.db.prepare(
      'SELECT role, content FROM conversations WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(sessionId, limit).reverse();
    // Decrypt user messages
    return rows.map(r => ({
      role: r.role,
      content: r.role === 'user' ? this.encryption.decrypt(r.content) : r.content,
    }));
  }

  getConversationHistory(limit = 50) {
    const rows = this.db.prepare(
      'SELECT role, content, timestamp FROM conversations ORDER BY timestamp DESC LIMIT ?'
    ).all(limit).reverse();
    return rows.map(r => ({
      ...r,
      content: r.role === 'user' ? this.encryption.decrypt(r.content) : r.content,
    }));
  }

  // ─── Semantic Memory Search (with decay scoring) ───────
  async searchMemories(query, limit = 5) {
    if (!this.embeddings.ready) {
      return this._keywordSearch(query, limit);
    }

    try {
      const queryEmbedding = await this.embeddings.embed(query);

      // Load all non-expired memories with embeddings
      const allMemories = this.db.prepare(
        `SELECT id, content, category, importance, access_count, embedding,
                last_accessed, created_at, expires_at
         FROM memories
         WHERE embedding IS NOT NULL
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`
      ).all();

      if (allMemories.length === 0) {
        return this._keywordSearch(query, limit);
      }

      // Deserialize embeddings and compute similarity
      const now = Date.now();
      const candidates = allMemories.map(m => {
        const embedding = EmbeddingService.fromBuffer(m.embedding);
        const similarity = this.embeddings.cosineSimilarity(queryEmbedding, embedding);

        // ─── Memory Decay Scoring ─────────────
        // Base: semantic similarity
        // Boost: importance, access frequency, recency
        // Decay: time since last access
        const daysSinceAccess = (now - new Date(m.last_accessed + 'Z').getTime()) / 86400000;
        const accessBoost = Math.log2(1 + (m.access_count || 0)) * 0.05; // +0.05 per doubling of access
        const importanceBoost = (m.importance - 1) * 0.03; // +0.03 per importance level above 1
        const recencyDecay = Math.max(0, daysSinceAccess * 0.005); // -0.005 per day since access

        const score = similarity + accessBoost + importanceBoost - recencyDecay;

        return { ...m, embedding, similarity, score };
      })
      .filter(c => c.similarity >= 0.2) // Lower threshold, let scoring handle ranking
      .sort((a, b) => b.score - a.score);

      const results = candidates.slice(0, limit);

      // Update access stats for retrieved memories
      for (const r of results) {
        this._updateMemoryAccess.run(r.id);
      }

      return results.map(r => ({
        id: r.id,
        content: r.content,
        category: r.category,
        importance: r.importance,
        similarity: r.similarity,
        score: r.score,
      }));
    } catch (e) {
      console.error('Semantic search failed, falling back to keyword search:', e.message);
      return this._keywordSearch(query, limit);
    }
  }

  // Legacy keyword-based search (fallback)
  _keywordSearch(query, limit = 5) {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) return [];

    const conditions = words.map(() => 'keywords LIKE ?').join(' OR ');
    const params = words.map(w => `%${w}%`);

    return this.db.prepare(
      `SELECT id, content, category, importance FROM memories
       WHERE (${conditions})
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       ORDER BY importance DESC, last_accessed DESC
       LIMIT ?`
    ).all(...params, limit);
  }

  // ─── Memory Storage ────────────────────────────────────
  async storeMemory(category, content, keywords, importance = 1, expiresAt = null) {
    let embeddingBuffer = null;
    if (this.embeddings.ready) {
      try {
        const embedding = await this.embeddings.embed(content);
        embeddingBuffer = EmbeddingService.toBuffer(embedding);
      } catch (e) { /* store without embedding */ }
    }

    // Coerce keywords — LLMs sometimes return an array or number instead of a string
    const kw = (Array.isArray(keywords) ? keywords.join(',') : String(keywords ?? '')).toLowerCase();

    // Store plaintext — encryption key file protects at-rest access to the DB
    // Profile values are encrypted at field level (most sensitive data)
    const result = this.db.prepare(
      'INSERT INTO memories (category, content, keywords, importance, embedding, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(category, content, kw, importance, embeddingBuffer, expiresAt);

    return result.lastInsertRowid;
  }

  // ─── Contradiction Detection & Memory Update ───────────
  async findContradiction(newContent, threshold = 0.7) {
    if (!this.embeddings.ready) return null;

    try {
      const newEmbedding = await this.embeddings.embed(newContent);
      const allMemories = this.db.prepare(
        'SELECT id, content, category, embedding FROM memories WHERE embedding IS NOT NULL'
      ).all();

      // Find memories that are related but might contradict
      const related = [];
      for (const mem of allMemories) {
        const memEmbedding = EmbeddingService.fromBuffer(mem.embedding);
        const similarity = this.embeddings.cosineSimilarity(newEmbedding, memEmbedding);
        if (similarity >= threshold && similarity < 0.85) {
          // Related but not a duplicate — potential contradiction
          related.push({ ...mem, similarity });
        }
      }

      return related.length > 0 ? related : null;
    } catch (e) {
      return null;
    }
  }

  // Replace an outdated memory with updated info
  async replaceMemory(id, newContent, newKeywords) {
    let embeddingBuffer = null;
    if (this.embeddings.ready) {
      try {
        const embedding = await this.embeddings.embed(newContent);
        embeddingBuffer = EmbeddingService.toBuffer(embedding);
      } catch (e) { /* keep old embedding */ }
    }
    const kw = (Array.isArray(newKeywords) ? newKeywords.join(',') : String(newKeywords ?? '')).toLowerCase();
    this._updateMemoryContent.run(newContent, kw, embeddingBuffer, id);
  }

  // Delete a memory
  deleteMemory(id) {
    this._deleteMemory.run(id);
  }

  // Check if a memory is a semantic duplicate
  async isDuplicate(content, threshold = 0.85) {
    if (!this.embeddings.ready) return false;

    try {
      const embedding = await this.embeddings.embed(content);
      const allMemories = this.db.prepare(
        'SELECT id, content, embedding FROM memories WHERE embedding IS NOT NULL'
      ).all();

      for (const mem of allMemories) {
        const memEmbedding = EmbeddingService.fromBuffer(mem.embedding);
        const similarity = this.embeddings.cosineSimilarity(embedding, memEmbedding);
        if (similarity >= threshold) return true;
      }
    } catch (e) { /* allow storage */ }
    return false;
  }

  // ─── Continuous Memory Extraction (per exchange) ───────
  async extractMemoriesFromExchange(llmService, userMsg, assistantMsg) {
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;

    try {
      const extraction = await llmService.chat(
        `You are a memory extraction system. Analyze this conversation exchange and extract facts about the user that should be remembered long-term.

IMPORTANT: The user's NAME, identity, and personal introductions are ALWAYS worth remembering (importance 5).

Return ONLY a valid JSON array. Each object must have:
- category: "fact" | "preference" | "event" | "relationship" | "emotion" | "routine"
- content: a concise standalone sentence about the user
- keywords: comma-separated search terms
- importance: 1-5 (5=name/identity, 4=life events, 3=preferences, 2=opinions, 1=minor)
- expires: null for permanent, or an ISO date string if this is temporary info (e.g., "on vacation until Friday")

Examples:
- "I am Vishnu" → [{"category":"fact","content":"User's name is Vishnu","keywords":"name,vishnu","importance":5,"expires":null}]
- "I work at Google" → [{"category":"fact","content":"User works at Google","keywords":"work,job,google","importance":4,"expires":null}]
- "I'm on vacation until next Wednesday" → [{"category":"event","content":"User is on vacation until next Wednesday","keywords":"vacation,time off","importance":3,"expires":"2026-02-25"}]

If truly nothing worth remembering, return []. Err on the side of remembering.`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );

      const cleaned = extraction.replace(/```json?|```/g, '').trim();
      const memories = JSON.parse(cleaned);

      if (!Array.isArray(memories)) return 0;

      let stored = 0;
      for (const m of memories) {
        if (!m.content || !m.keywords) continue;
        try {
          // Check for contradictions first
          const contradictions = await this.findContradiction(m.content);
          if (contradictions && contradictions.length > 0) {
            // Replace the most related contradicting memory
            const topContradiction = contradictions.sort((a, b) => b.similarity - a.similarity)[0];
            await this.replaceMemory(topContradiction.id, m.content, m.keywords);
            console.log(`🔄 Updated memory [${topContradiction.id}]: "${topContradiction.content.slice(0, 40)}..." → "${m.content.slice(0, 40)}..."`);
            stored++;
            continue;
          }

          // Semantic deduplication
          const duplicate = await this.isDuplicate(m.content);
          if (duplicate) continue;

          await this.storeMemory(m.category || 'fact', m.content, m.keywords, m.importance || 1, m.expires || null);
          stored++;
        } catch (itemErr) {
          console.error('Skipped malformed memory item:', itemErr.message);
        }
      }

      if (stored > 0) {
        console.log(`💾 Extracted ${stored} new memories (${memories.length - stored} duplicates skipped)`);
      }
      return stored;
    } catch (e) {
      if (e instanceof SyntaxError) return 0;
      console.error('Memory extraction failed:', e.message);
      return 0;
    }
  }

  // ─── User Model / Deep Profile ─────────────────────────
  async updateUserModel(llmService, userMsg, assistantMsg) {
    const currentProfile = this.getProfile();
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;

    const profileContext = Object.keys(currentProfile).length > 0
      ? `Current user profile:\n${JSON.stringify(currentProfile, null, 2)}`
      : 'No user profile exists yet.';

    try {
      const result = await llmService.chat(
        `You are a profile extraction system. You ONLY output valid JSON, never conversational text.

Analyze this exchange and extract any user profile information to store.

${profileContext}

Profile fields (only include fields with new information):
- name: string (user's name)
- job: string
- location: string
- relationships: JSON array of {"name","relation","notes"}
- routines: JSON array of strings
- preferences: JSON object {"category": "preference"}
- goals: JSON array of strings
- interests: JSON array of strings
- communication_style: string
- schedule_patterns: JSON array of strings

RULES:
1. Return ONLY a JSON object — no explanation, no markdown, no conversation
2. Only include fields that have new info from this exchange
3. If nothing to update, return exactly: {}
4. For array fields, include the COMPLETE array (merge with existing data)

Example input: "user: I am Vishnu" → Output: {"name":"Vishnu"}
Example input: "user: I work at Google and love hiking" → Output: {"job":"Google","interests":["hiking"]}`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );

      const cleaned = result.replace(/```json?|```/g, '').trim();
      const updates = JSON.parse(cleaned);

      if (typeof updates === 'object' && !Array.isArray(updates)) {
        for (const [key, value] of Object.entries(updates)) {
          const strValue = typeof value === 'string' ? value : JSON.stringify(value);
          this.updateProfile(key, strValue);
        }
        const count = Object.keys(updates).length;
        if (count > 0) {
          console.log(`👤 Updated ${count} profile fields: ${Object.keys(updates).join(', ')}`);
        }
      }
    } catch (e) {
      if (e instanceof SyntaxError) return;
      console.error('Profile update failed:', e.message);
    }
  }

  // Get formatted profile for system prompt
  getFormattedProfile() {
    const profile = this.getProfile();
    if (Object.keys(profile).length === 0) return '';

    const lines = [];
    const fieldLabels = {
      name: 'Name', job: 'Job', location: 'Location',
      relationships: 'Relationships', routines: 'Routines',
      preferences: 'Preferences', goals: 'Goals', interests: 'Interests',
      communication_style: 'Communication Style', schedule_patterns: 'Schedule',
    };

    for (const [key, value] of Object.entries(profile)) {
      const label = fieldLabels[key] || key;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          if (parsed.length > 0 && typeof parsed[0] === 'object') {
            lines.push(`- ${label}: ${parsed.map(item => {
              if (item.name && item.relation) return `${item.name} (${item.relation})`;
              return JSON.stringify(item);
            }).join(', ')}`);
          } else {
            lines.push(`- ${label}: ${parsed.join(', ')}`);
          }
        } else if (typeof parsed === 'object') {
          lines.push(`- ${label}: ${Object.entries(parsed).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
        } else {
          lines.push(`- ${label}: ${value}`);
        }
      } catch {
        lines.push(`- ${label}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  // ─── Memory Decay: Cleanup ─────────────────────────────
  // Remove expired memories and very old never-accessed ones
  cleanupDecayedMemories() {
    // Delete expired temporal memories (expires_at stored as UTC ISO)
    const expired = this.db.prepare(
      "DELETE FROM memories WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')"
    ).run();

    // Delete very old, low-importance, never-reinforced memories (>90 days, importance 1, access_count 0)
    const decayed = this.db.prepare(
      `DELETE FROM memories
       WHERE access_count = 0
       AND importance <= 1
       AND created_at < datetime('now', '-90 days')`
    ).run();

    const total = expired.changes + decayed.changes;
    if (total > 0) {
      console.log(`🧹 Memory cleanup: ${expired.changes} expired, ${decayed.changes} decayed`);
    }
  }

  // ─── Legacy extraction ─────────────────────────────────
  async extractMemories(llmService, messages) {
    if (messages.length < 4) return;
    const recentText = messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    try {
      const extraction = await llmService.chat(
        `Analyze this conversation and extract important facts to remember about the user.
Return ONLY a JSON array of objects with: category, content, keywords, importance (1-5).
If nothing worth remembering, return [].`,
        [{ role: 'user', content: recentText }]
      );
      const cleaned = extraction.replace(/```json?|```/g, '').trim();
      const memories = JSON.parse(cleaned);
      if (Array.isArray(memories)) {
        for (const m of memories) {
          if (m.content && m.keywords) {
            await this.storeMemory(m.category || 'general', m.content, m.keywords, m.importance || 1);
          }
        }
        console.log(`💾 Extracted ${memories.length} memories`);
      }
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Memory extraction failed:', e.message);
    }
  }

  // ─── Profile ───────────────────────────────────────────
  updateProfile(key, value) {
    // Encrypt profile values
    this._upsertProfile.run(key, this.encryption.encrypt(value));
  }

  getProfile() {
    const rows = this.db.prepare('SELECT key, value FROM user_profile').all();
    const profile = {};
    rows.forEach(r => profile[r.key] = this.encryption.decrypt(r.value));
    return profile;
  }

  // ─── Reminders ─────────────────────────────────────────
  createReminder(content, triggerTime, recurrence = null) {
    return this.db.prepare(
      'INSERT INTO reminders (content, trigger_time, recurrence) VALUES (?, ?, ?)'
    ).run(content, triggerTime, recurrence);
  }

  getDueReminders() {
    return this.db.prepare(
      "SELECT id, content, trigger_time, recurrence FROM reminders WHERE status = 'pending' AND trigger_time <= datetime('now', 'localtime')"
    ).all();
  }

  markReminderTriggered(id) {
    this.db.prepare("UPDATE reminders SET status = 'triggered' WHERE id = ?").run(id);
  }

  cancelReminder(id) {
    this.db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ?").run(id);
  }

  getUpcomingReminders(limit = 10) {
    return this.db.prepare(
      "SELECT id, content, trigger_time, recurrence FROM reminders WHERE status = 'pending' ORDER BY trigger_time ASC LIMIT ?"
    ).all(limit);
  }

  // ─── Push Subscriptions ────────────────────────────────
  savePushSubscription(endpoint, keysJson) {
    this.db.prepare(
      'INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)'
    ).run(endpoint, keysJson);
  }

  getAllPushSubscriptions() {
    return this.db.prepare('SELECT endpoint, keys_json FROM push_subscriptions').all();
  }

  removePushSubscription(endpoint) {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  // ─── Relationship Tracking ───────────────────────────────
  upsertRelationship(name, type, context) {
    const existing = this._findRelationship.get(name);
    if (existing) {
      this._updateRelationship.run(type, context, existing.id);
      return existing.id;
    }
    return this._insertRelationship.run(name, type, context).lastInsertRowid;
  }

  getRelationships() {
    return this.db.prepare('SELECT * FROM relationships ORDER BY mention_count DESC').all();
  }

  getFormattedRelationships() {
    const rels = this.getRelationships();
    if (rels.length === 0) return '';
    return rels.map(r => {
      let line = `- ${r.person_name}`;
      if (r.relationship_type) line += ` (${r.relationship_type})`;
      if (r.context) line += `: ${r.context}`;
      return line;
    }).join('\n');
  }

  async extractRelationships(llmService, userMsg, assistantMsg) {
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;
    try {
      const result = await llmService.chat(
        `Extract any people mentioned in this exchange. Return ONLY a JSON array.
Each object: {"name": "person name", "relationship": "friend/family/coworker/etc", "context": "brief note"}
If no people mentioned, return [].`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const people = JSON.parse(cleaned);
      if (!Array.isArray(people)) return 0;
      let count = 0;
      for (const p of people) {
        if (!p.name) continue;
        this.upsertRelationship(p.name, p.relationship || null, p.context || null);
        count++;
      }
      if (count > 0) console.log(`👥 Tracked ${count} relationship(s)`);
      return count;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Relationship extraction failed:', e.message);
      return 0;
    }
  }

  // ─── Task Tracking ────────────────────────────────────────
  createTask(content, priority = 'medium', dueDate = null) {
    return this._insertTask.run(content, 'pending', priority, dueDate).lastInsertRowid;
  }

  setTaskCalendarEvent(taskId, calendarEventId) {
    this.db.prepare('UPDATE tasks SET calendar_event_id = ? WHERE id = ?').run(calendarEventId, taskId);
  }

  getTask(id) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  getTasks(status = null) {
    if (status) {
      return this.db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC').all(status);
    }
    return this.db.prepare("SELECT * FROM tasks WHERE status != 'completed' ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC").all();
  }

  completeTask(id) {
    this._updateTaskStatus.run('completed', 'completed', id);
  }

  updateTask(id, updates) {
    const fields = [];
    const values = [];
    if (updates.content) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.priority) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.due_date !== undefined) { fields.push('due_date = ?'); values.push(updates.due_date); }
    if (updates.status) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.calendar_event_id !== undefined) { fields.push('calendar_event_id = ?'); values.push(updates.calendar_event_id); }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteTask(id) {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  getFormattedTasks() {
    const tasks = this.getTasks();
    if (tasks.length === 0) return '';
    return tasks.map(t => {
      let line = `- [${t.status}] ${t.content}`;
      if (t.priority === 'high') line += ' (HIGH)';
      if (t.due_date) line += ` — due: ${t.due_date}`;
      return line;
    }).join('\n');
  }

  async extractTasks(llmService, userMsg, assistantMsg) {
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;
    try {
      const result = await llmService.chat(
        `Detect any tasks, todos, or commitments the user mentioned. Return ONLY a JSON array.
Each object: {"content": "task description", "priority": "high/medium/low", "due_date": "ISO date or null"}
Look for: "I need to...", "I should...", "remind me to...", "I have to...", deadlines, commitments.
If no tasks detected, return [].`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const tasks = JSON.parse(cleaned);
      if (!Array.isArray(tasks)) return 0;
      let count = 0;
      for (const t of tasks) {
        if (!t.content) continue;
        this.createTask(t.content, t.priority || 'medium', t.due_date || null);
        count++;
      }
      if (count > 0) console.log(`✅ Tracked ${count} task(s)`);
      return count;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Task extraction failed:', e.message);
      return 0;
    }
  }

  // ─── Preference Learning ──────────────────────────────────
  upsertPreference(category, preference, source = 'explicit', confidence = 1.0) {
    const existing = this._findPreference.get(category, preference);
    if (existing) {
      this._reinforcePreference.run(existing.id);
      return existing.id;
    }
    return this._insertPreference.run(category, preference, source, confidence).lastInsertRowid;
  }

  getPreferences(category = null) {
    if (category) {
      return this.db.prepare('SELECT * FROM preferences WHERE LOWER(category) = LOWER(?) ORDER BY confidence DESC').all(category);
    }
    return this.db.prepare('SELECT * FROM preferences ORDER BY category, confidence DESC').all();
  }

  getFormattedPreferences() {
    const prefs = this.getPreferences();
    if (prefs.length === 0) return '';
    const grouped = {};
    for (const p of prefs) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p.preference);
    }
    return Object.entries(grouped)
      .map(([cat, items]) => `- ${cat}: ${items.join(', ')}`)
      .join('\n');
  }

  async extractPreferences(llmService, userMsg, assistantMsg) {
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;
    try {
      const result = await llmService.chat(
        `Detect any user preferences (explicit or implicit) from this exchange. Return ONLY a JSON array.
Each object: {"category": "food/music/tech/work/communication/etc", "preference": "concise preference", "source": "explicit" or "implicit", "confidence": 0.0-1.0}
Explicit: "I love sushi" → confidence 1.0
Implicit: user picks dark mode → confidence 0.6
If no preferences detected, return [].`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const prefs = JSON.parse(cleaned);
      if (!Array.isArray(prefs)) return 0;
      let count = 0;
      for (const p of prefs) {
        if (!p.category || !p.preference) continue;
        this.upsertPreference(p.category, p.preference, p.source || 'implicit', p.confidence || 0.5);
        count++;
      }
      if (count > 0) console.log(`⭐ Learned ${count} preference(s)`);
      return count;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Preference extraction failed:', e.message);
      return 0;
    }
  }

  // ─── Entity Extraction ────────────────────────────────────
  upsertEntity(name, type, attributes = null) {
    const existing = this._findEntity.get(name, type);
    if (existing) {
      this._updateEntity.run(attributes || existing.attributes, existing.id);
      return existing.id;
    }
    return this._insertEntity.run(name, type, attributes).lastInsertRowid;
  }

  getEntities(type = null) {
    if (type) {
      return this.db.prepare('SELECT * FROM entities WHERE type = ? ORDER BY mention_count DESC').all(type);
    }
    return this.db.prepare('SELECT * FROM entities ORDER BY mention_count DESC').all();
  }

  async extractEntities(llmService, userMsg, assistantMsg) {
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;
    try {
      const result = await llmService.chat(
        `Extract named entities from this exchange. Return ONLY a JSON array.
Each object: {"name": "entity name", "type": "person/place/organization/date/product/event", "attributes": "brief description or null"}
If no notable entities, return [].`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const entities = JSON.parse(cleaned);
      if (!Array.isArray(entities)) return 0;
      let count = 0;
      for (const e of entities) {
        if (!e.name || !e.type) continue;
        this.upsertEntity(e.name, e.type, e.attributes || null);
        count++;
      }
      return count;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Entity extraction failed:', e.message);
      return 0;
    }
  }

  // ─── Consolidated post-turn extraction (ONE LLM call) ─────────────────
  // Supersedes the eight separate post-turn extractors. Makes a single typed
  // structured-output call (via llm.extractStructured), then fans the parsed
  // result into the existing storage primitives. This is the main latency/cost
  // fix: the old fan-out fired 8 LLM calls per turn, which on Groq's 12k-TPM
  // free tier tripped 429s and made the *next* turn crawl (the "razor fast →
  // slow" regression), and on Claude cost ~8x per turn. moodService is passed in
  // so the mood lands in mood_log (read by getMoodContext on the next turn).
  async extractAndStore(llmService, userMsg, assistantMsg, sessionId, moodService = null) {
    // Skip trivial exchanges (greetings/acks) — nothing to learn, and it spares
    // the rate-limited free tier an extra call.
    if (`${userMsg} ${assistantMsg}`.replace(/\s+/g, ' ').trim().length < 25) return;
    const profile = this.getProfile();
    const profileNote = Object.keys(profile).length
      ? `\n\nKnown profile (only return fields that change): ${JSON.stringify(profile)}`
      : '';
    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;

    let data;
    try {
      // Run extraction on the FAST model. On Groq the 8b model draws from a
      // SEPARATE tokens-per-minute pool than the 70b agent, so this background
      // call no longer competes with the user-facing reply for rate limit — the
      // main cause of turns 429-ing (→ no audio + slow). On Claude this is Haiku.
      data = await llmService.extractStructured(EXTRACTION_SYSTEM + profileNote, exchange, EXTRACTION_SCHEMA, { useMainModel: false });
    } catch (e) {
      console.error('❌ Consolidated extraction failed:', e.message);
      return;
    }
    if (!data || typeof data !== 'object') return;

    // Each section is guarded independently so one malformed part can't drop the
    // rest. All writes are cheap local SQLite ops.
    try {
      let stored = 0;
      for (const m of data.memories || []) {
        if (!m.content || !m.keywords) continue;
        try {
          const contradictions = await this.findContradiction(m.content);
          if (contradictions && contradictions.length > 0) {
            const top = contradictions.sort((a, b) => b.similarity - a.similarity)[0];
            await this.replaceMemory(top.id, m.content, m.keywords);
            stored++;
            continue;
          }
          if (await this.isDuplicate(m.content)) continue;
          await this.storeMemory(m.category || 'fact', m.content, m.keywords, m.importance || 2, m.expires || null);
          stored++;
        } catch (itemErr) { /* skip malformed item */ }
      }
      if (stored > 0) console.log(`💾 Extracted ${stored} new memor${stored === 1 ? 'y' : 'ies'}`);
    } catch (e) { console.error('memory section failed:', e.message); }

    try {
      const entries = Object.entries(data.profile || {}).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0));
      for (const [k, v] of entries) this.updateProfile(k, typeof v === 'string' ? v : JSON.stringify(v));
      if (entries.length) console.log(`👤 Updated ${entries.length} profile field(s): ${entries.map(([k]) => k).join(', ')}`);
    } catch (e) { console.error('profile section failed:', e.message); }

    try {
      let n = 0;
      for (const p of data.relationships || []) { if (p.name) { this.upsertRelationship(p.name, p.relationship || null, p.context || null); n++; } }
      if (n) console.log(`👥 Tracked ${n} relationship(s)`);
    } catch (e) { console.error('relationships section failed:', e.message); }

    try {
      let n = 0;
      for (const t of data.tasks || []) { if (t.content) { this.createTask(t.content, t.priority || 'medium', t.due_date || null); n++; } }
      if (n) console.log(`✅ Tracked ${n} task(s)`);
    } catch (e) { console.error('tasks section failed:', e.message); }

    try {
      for (const p of data.preferences || []) { if (p.category && p.preference) this.upsertPreference(p.category, p.preference, p.source || 'implicit', p.confidence ?? 0.6); }
    } catch (e) { console.error('preferences section failed:', e.message); }

    try {
      for (const en of data.entities || []) { if (en.name && en.type) this.upsertEntity(en.name, en.type, en.attributes || null); }
    } catch (e) { console.error('entities section failed:', e.message); }

    try {
      let n = 0;
      for (const f of data.followUps || []) {
        if (!f.topic) continue;
        const checkAfter = formatDateTime(new Date(Date.now() + (f.check_after_hours || 24) * 3600000));
        this.createFollowUp(f.topic, f.context || '', checkAfter);
        n++;
      }
      if (n) console.log(`🔔 Created ${n} follow-up(s)`);
    } catch (e) { console.error('follow-ups section failed:', e.message); }

    try {
      if (moodService && data.mood && data.mood.mood) {
        moodService.logMood(sessionId, data.mood.mood, data.mood.intensity ?? 0.5, data.mood.triggers || '');
        if (data.mood.mood !== 'neutral') console.log(`😊 Mood: ${data.mood.mood} (${data.mood.intensity})`);
      }
    } catch (e) { console.error('mood section failed:', e.message); }
  }

  // ─── Session Summarization ────────────────────────────────
  async summarizeSession(llmService, sessionId) {
    const messages = this.getRecentMessages(sessionId, 100);
    if (messages.length < 4) return null;

    const transcript = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    try {
      const result = await llmService.chat(
        `Summarize this conversation session in 2-3 sentences. Also list the main topics discussed.
Return ONLY a JSON object: {"summary": "...", "topics": "topic1, topic2, topic3"}`,
        [{ role: 'user', content: transcript }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (!parsed.summary) return null;

      this._insertSummary.run(sessionId, parsed.summary, parsed.topics || '', messages.length);
      console.log(`📝 Session summarized: "${parsed.summary.slice(0, 60)}..."`);
      return parsed;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Session summarization failed:', e.message);
      return null;
    }
  }

  getRecentSummaries(limit = 5) {
    return this.db.prepare(
      'SELECT summary, topics, created_at FROM session_summaries ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }

  getFormattedSummaries() {
    const summaries = this.getRecentSummaries();
    if (summaries.length === 0) return '';
    return summaries.map(s => {
      const date = new Date(s.created_at).toLocaleDateString();
      return `- [${date}] ${s.summary}${s.topics ? ` (Topics: ${s.topics})` : ''}`;
    }).join('\n');
  }

  // ─── Routine Detection ────────────────────────────────────
  detectRoutines() {
    // Analyze conversation timestamps for patterns
    const rows = this.db.prepare(
      `SELECT strftime('%H', timestamp) as hour, strftime('%w', timestamp) as dow, COUNT(*) as count
       FROM conversations WHERE role = 'user'
       AND timestamp > datetime('now', '-30 days')
       GROUP BY hour, dow HAVING count >= 3
       ORDER BY count DESC LIMIT 10`
    ).all();

    if (rows.length === 0) return;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let detected = 0;

    for (const row of rows) {
      const pattern = `Usually active around ${row.hour}:00 on ${dayNames[row.dow]}s`;
      const existing = this.db.prepare(
        'SELECT id FROM routines WHERE pattern = ?'
      ).get(pattern);

      if (!existing) {
        this._insertRoutine.run(pattern, 'time', Math.min(1.0, row.count / 10), `${row.count} messages`);
        detected++;
      }
    }

    // Detect topic routines from memories
    const topicPatterns = this.db.prepare(
      `SELECT category, COUNT(*) as count FROM memories
       GROUP BY category HAVING count >= 3 ORDER BY count DESC LIMIT 5`
    ).all();

    for (const tp of topicPatterns) {
      const pattern = `Frequently discusses: ${tp.category}`;
      const existing = this.db.prepare('SELECT id FROM routines WHERE pattern = ?').get(pattern);
      if (!existing) {
        this._insertRoutine.run(pattern, 'topic', Math.min(1.0, tp.count / 10), `${tp.count} memories`);
        detected++;
      }
    }

    if (detected > 0) console.log(`🔄 Detected ${detected} new routine(s)`);
  }

  getFormattedRoutines() {
    const routines = this.db.prepare('SELECT * FROM routines ORDER BY confidence DESC LIMIT 10').all();
    if (routines.length === 0) return '';
    return routines.map(r => `- ${r.pattern} (confidence: ${(r.confidence * 100).toFixed(0)}%)`).join('\n');
  }

  // ─── Notes ────────────────────────────────────────────────
  async saveNote(title, content, tags = '') {
    let embeddingBuffer = null;
    if (this.embeddings.ready) {
      try {
        const embedding = await this.embeddings.embed(content);
        embeddingBuffer = EmbeddingService.toBuffer(embedding);
      } catch (e) { /* store without */ }
    }
    return this._insertNote.run(title, content, tags, embeddingBuffer).lastInsertRowid;
  }

  getAllNotes() {
    return this.db.prepare('SELECT id, title, content, tags, created_at FROM notes ORDER BY created_at DESC').all();
  }

  async searchNotes(query, limit = 5) {
    if (this.embeddings.ready) {
      try {
        const queryEmb = await this.embeddings.embed(query);
        const allNotes = this.db.prepare('SELECT id, title, content, tags, embedding, created_at FROM notes WHERE embedding IS NOT NULL').all();
        const scored = allNotes.map(n => {
          const emb = EmbeddingService.fromBuffer(n.embedding);
          const similarity = this.embeddings.cosineSimilarity(queryEmb, emb);
          return { ...n, similarity };
        }).filter(n => n.similarity >= 0.3).sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, limit).map(({ embedding, ...rest }) => rest);
      } catch (e) { /* fall through to keyword */ }
    }
    // Keyword fallback
    return this.db.prepare(
      'SELECT id, title, content, tags, created_at FROM notes WHERE content LIKE ? OR title LIKE ? OR tags LIKE ? LIMIT ?'
    ).all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
  }

  deleteNote(id) {
    this._deleteNote.run(id);
  }

  // ─── Follow-Ups ───────────────────────────────────────────
  createFollowUp(topic, context, checkAfter) {
    return this._insertFollowUp.run(topic, context, checkAfter).lastInsertRowid;
  }

  getDueFollowUps() {
    // check_after is stored in local-time format (via timeparser.formatDateTime),
    // so compare against localtime. datetime() normalizes any ISO/space format.
    return this.db.prepare(
      "SELECT * FROM follow_ups WHERE status = 'pending' AND datetime(check_after) <= datetime('now', 'localtime')"
    ).all();
  }

  getPendingFollowUps() {
    return this.db.prepare(
      "SELECT * FROM follow_ups WHERE status = 'pending' ORDER BY check_after ASC"
    ).all();
  }

  markFollowUpDone(id) {
    this._updateFollowUpStatus.run('done', id);
  }

  getFormattedFollowUps() {
    const fups = this.getPendingFollowUps();
    if (fups.length === 0) return '';
    return fups.map(f => `- ${f.topic}${f.context ? ` (${f.context})` : ''} — check after: ${f.check_after}`).join('\n');
  }

  // ─── Privacy Operations ───────────────────────────────────
  deleteLastExchange(sessionId) {
    // Delete last user + assistant message pair
    const lastMessages = this.db.prepare(
      'SELECT id FROM conversations WHERE session_id = ? ORDER BY timestamp DESC LIMIT 2'
    ).all(sessionId);
    for (const m of lastMessages) {
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(m.id);
    }
    return lastMessages.length;
  }

  forgetTopic(topic) {
    // Delete memories matching topic
    const deleted = this.db.prepare(
      'DELETE FROM memories WHERE LOWER(content) LIKE ? OR LOWER(keywords) LIKE ?'
    ).run(`%${topic.toLowerCase()}%`, `%${topic.toLowerCase()}%`);
    return deleted.changes;
  }

  // ─── Persisted app config (integration keys) ──────────
  setAppConfig(key, value) {
    this.db.prepare(
      'INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).run(key, value);
  }

  getAppConfig() {
    const rows = this.db.prepare('SELECT key, value FROM app_config').all();
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  // ─── Stats ─────────────────────────────────────────────
  getStats() {
    const totalMessages = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const totalMemories = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const uniqueSessions = this.db.prepare('SELECT COUNT(DISTINCT session_id) as count FROM conversations').get().count;
    const pendingReminders = this.db.prepare("SELECT COUNT(*) as count FROM reminders WHERE status = 'pending'").get().count;
    return { totalMessages, totalMemories, uniqueSessions, pendingReminders };
  }

  close() {
    this.db.close();
  }
}

module.exports = MemoryService;
