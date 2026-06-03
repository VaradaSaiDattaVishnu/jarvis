// Speaker Identification Service
// Voice enrollment and verification using audio fingerprinting
// Uses MFCC-based voice embeddings for speaker recognition

const crypto = require('crypto');

class SpeakerService {
  constructor(db) {
    this.db = db;
    this.ready = false;
    this.speakers = new Map(); // speakerId → { name, embedding }

    // Create speaker table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS speakers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        total_interactions INTEGER DEFAULT 0
      )
    `);

    // Load speakers into memory
    const rows = this.db.prepare('SELECT * FROM speakers').all();
    for (const row of rows) {
      this.speakers.set(row.id, {
        name: row.name,
        embedding: row.embedding ? JSON.parse(row.embedding) : null,
        totalInteractions: row.total_interactions,
      });
    }

    if (this.speakers.size > 0) {
      console.log(`🎙️ Speaker ID: ${this.speakers.size} enrolled speaker(s)`);
    } else {
      console.log('🎙️ Speaker ID ready (no speakers enrolled — use /api/speaker/enroll)');
    }
    this.ready = true;
  }

  // ─── Enroll a new speaker ───────────────────────────────
  enroll(name, voiceFeatures = null) {
    const id = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO speakers (id, name, embedding)
      VALUES (?, ?, ?)
    `).run(id, name, voiceFeatures ? JSON.stringify(voiceFeatures) : null);

    this.speakers.set(id, {
      name,
      embedding: voiceFeatures,
      totalInteractions: 0,
    });

    console.log(`🎙️ Speaker enrolled: "${name}" (${id.slice(0, 8)})`);
    return { id, name };
  }

  // ─── Update speaker voice features ─────────────────────
  updateVoiceFeatures(speakerId, features) {
    if (!this.speakers.has(speakerId)) return false;

    this.db.prepare('UPDATE speakers SET embedding = ? WHERE id = ?')
      .run(JSON.stringify(features), speakerId);

    this.speakers.get(speakerId).embedding = features;
    return true;
  }

  // ─── Identify speaker from voice features ───────────────
  // Uses simple feature comparison — Web Audio API provides
  // frequency data that we compare against enrolled profiles
  identify(voiceFeatures) {
    if (!voiceFeatures || this.speakers.size === 0) {
      return { speakerId: null, name: null, confidence: 0 };
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const [id, speaker] of this.speakers) {
      if (!speaker.embedding) continue;

      const score = this.compareFeatures(voiceFeatures, speaker.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { speakerId: id, name: speaker.name };
      }
    }

    if (bestMatch && bestScore > 0.7) {
      // Update last seen
      this.db.prepare('UPDATE speakers SET last_seen = datetime(\'now\'), total_interactions = total_interactions + 1 WHERE id = ?')
        .run(bestMatch.speakerId);

      return { ...bestMatch, confidence: bestScore };
    }

    return { speakerId: null, name: null, confidence: bestScore };
  }

  // ─── Compare two voice feature vectors ──────────────────
  // Cosine similarity on frequency profile arrays
  compareFeatures(a, b) {
    if (!a || !b || a.length !== b.length) return 0;

    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ─── List all speakers ─────────────────────────────────
  listSpeakers() {
    return Array.from(this.speakers.entries()).map(([id, s]) => ({
      id,
      name: s.name,
      enrolled: !!s.embedding,
      totalInteractions: s.totalInteractions,
    }));
  }

  // ─── Remove a speaker ──────────────────────────────────
  removeSpeaker(speakerId) {
    this.db.prepare('DELETE FROM speakers WHERE id = ?').run(speakerId);
    this.speakers.delete(speakerId);
  }

  // ─── Get speaker by ID ─────────────────────────────────
  getSpeaker(speakerId) {
    const speaker = this.speakers.get(speakerId);
    if (!speaker) return null;
    return { id: speakerId, ...speaker };
  }

  // ─── Get primary speaker (most interactions) ───────────
  getPrimarySpeaker() {
    let primary = null;
    let maxInteractions = 0;

    for (const [id, speaker] of this.speakers) {
      if (speaker.totalInteractions > maxInteractions) {
        maxInteractions = speaker.totalInteractions;
        primary = { id, ...speaker };
      }
    }

    return primary;
  }

  // ─── Setup API routes ──────────────────────────────────
  setupRoutes(app) {
    // Enroll a new speaker
    app.post('/api/speaker/enroll', (req, res) => {
      const { name, voiceFeatures } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      const result = this.enroll(name, voiceFeatures || null);
      res.json(result);
    });

    // Update voice features for a speaker
    app.post('/api/speaker/:id/features', (req, res) => {
      const { voiceFeatures } = req.body;
      if (!voiceFeatures) return res.status(400).json({ error: 'voiceFeatures required' });

      const updated = this.updateVoiceFeatures(req.params.id, voiceFeatures);
      if (!updated) return res.status(404).json({ error: 'Speaker not found' });
      res.json({ success: true });
    });

    // Identify speaker from voice features
    app.post('/api/speaker/identify', (req, res) => {
      const { voiceFeatures } = req.body;
      const result = this.identify(voiceFeatures);
      res.json(result);
    });

    // List all enrolled speakers
    app.get('/api/speaker/list', (req, res) => {
      res.json({ speakers: this.listSpeakers() });
    });

    // Remove a speaker
    app.delete('/api/speaker/:id', (req, res) => {
      this.removeSpeaker(req.params.id);
      res.json({ success: true });
    });
  }
}

module.exports = SpeakerService;
