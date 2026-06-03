// J.A.R.V.I.S — Privacy Service
// Handles "forget", "off the record", and data management

class PrivacyService {
  constructor({ memoryService }) {
    this.memory = memoryService;
    this.offTheRecord = new Set(); // Set of session IDs that are off-record
  }

  // Check if a session is off the record
  isOffTheRecord(sessionId) {
    return this.offTheRecord.has(sessionId);
  }

  goOffTheRecord(sessionId) {
    this.offTheRecord.add(sessionId);
    console.log(`🔒 Session ${sessionId.slice(0, 8)} is now off the record`);
    return true;
  }

  goOnTheRecord(sessionId) {
    this.offTheRecord.delete(sessionId);
    console.log(`🔓 Session ${sessionId.slice(0, 8)} is back on the record`);
    return true;
  }

  // "Forget what I just said" — delete last exchange
  forgetLastExchange(sessionId) {
    const deleted = this.memory.deleteLastExchange(sessionId);
    console.log(`🗑️ Deleted last ${deleted} messages from session ${sessionId.slice(0, 8)}`);
    return { deleted, success: true };
  }

  // "Don't remember anything about [topic]"
  forgetTopic(topic) {
    const deleted = this.memory.forgetTopic(topic);
    console.log(`🗑️ Forgot ${deleted} memories about "${topic}"`);
    return { deleted, topic, success: true };
  }

  // Delete a specific memory by ID
  deleteMemory(id) {
    this.memory.deleteMemory(id);
    return { success: true };
  }

  // Get all stored data for the user (data export)
  exportAllData() {
    const profile = this.memory.getProfile();
    const stats = this.memory.getStats();
    const memories = this.memory.db.prepare('SELECT id, category, content, importance, created_at FROM memories').all();
    const relationships = this.memory.getRelationships();
    const tasks = this.memory.db.prepare('SELECT * FROM tasks').all();
    const preferences = this.memory.getPreferences();
    const notes = this.memory.getAllNotes();

    return {
      exportDate: new Date().toISOString(),
      profile,
      stats,
      memories,
      relationships,
      tasks,
      preferences,
      notes,
    };
  }

  // Detect privacy commands in user text
  detectPrivacyIntent(text) {
    const lower = text.toLowerCase();

    if (/forget (what i (just )?said|that|the last thing)/i.test(lower)) {
      return { action: 'forget_last' };
    }
    if (/don'?t remember (anything )?about (.+)/i.test(lower)) {
      const match = lower.match(/don'?t remember (anything )?about (.+)/i);
      return { action: 'forget_topic', topic: match[2].trim() };
    }
    if (/go off the record|stop recording|private mode/i.test(lower)) {
      return { action: 'off_record' };
    }
    if (/back on the record|resume recording|normal mode/i.test(lower)) {
      return { action: 'on_record' };
    }
    if (/delete (that )?memory|remove (that )?memory/i.test(lower)) {
      return { action: 'forget_last' };
    }

    return null;
  }

  setupRoutes(app) {
    // Export all user data
    app.get('/api/privacy/data', (req, res) => {
      const data = this.exportAllData();
      res.json(data);
    });

    // Delete specific memory
    app.delete('/api/privacy/memories/:id', (req, res) => {
      this.deleteMemory(parseInt(req.params.id));
      res.json({ success: true });
    });

    // Forget by topic
    app.post('/api/privacy/forget-topic', (req, res) => {
      const { topic } = req.body;
      if (!topic) return res.status(400).json({ error: 'Topic required' });
      const result = this.forgetTopic(topic);
      res.json(result);
    });

    // Off/on the record
    app.post('/api/privacy/off-record', (req, res) => {
      const { sessionId } = req.body;
      if (sessionId) this.goOffTheRecord(sessionId);
      res.json({ success: true, offTheRecord: true });
    });

    app.post('/api/privacy/on-record', (req, res) => {
      const { sessionId } = req.body;
      if (sessionId) this.goOnTheRecord(sessionId);
      res.json({ success: true, offTheRecord: false });
    });
  }
}

module.exports = PrivacyService;
