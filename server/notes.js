// J.A.R.V.I.S — Notes Service (voice-first note-taking)

class NoteService {
  constructor({ memoryService }) {
    this.memory = memoryService;
  }

  needsNotes(text) {
    const lower = text.toLowerCase();
    const triggers = [
      'take a note', 'save a note', 'note this', 'write down',
      'remember this note', 'my notes', 'search notes', 'find note',
      'show notes', 'delete note', 'jot down',
    ];
    return triggers.some(t => lower.includes(t));
  }

  async save(title, content, tags = '') {
    const id = await this.memory.saveNote(title, content, tags);
    console.log(`📝 Note saved: "${title || content.slice(0, 40)}..."`);
    return { id, success: true };
  }

  async search(query, limit = 5) {
    return this.memory.searchNotes(query, limit);
  }

  getAll() {
    return this.memory.getAllNotes();
  }

  delete(id) {
    this.memory.deleteNote(id);
    return { success: true };
  }

  async exportNotes(format = 'json') {
    const notes = this.getAll();
    if (format === 'markdown') {
      return notes.map(n =>
        `## ${n.title || 'Untitled'}\n${n.content}\n*Tags: ${n.tags || 'none'} | Created: ${n.created_at}*\n`
      ).join('\n---\n\n');
    }
    return JSON.stringify(notes, null, 2);
  }

  setupRoutes(app) {
    app.get('/api/notes', (req, res) => {
      res.json({ notes: this.getAll() });
    });

    app.post('/api/notes', async (req, res) => {
      const { title, content, tags } = req.body;
      if (!content) return res.status(400).json({ error: 'Content required' });
      const result = await this.save(title || null, content, tags || '');
      res.json(result);
    });

    app.get('/api/notes/search', async (req, res) => {
      const query = req.query.q;
      if (!query) return res.status(400).json({ error: 'Query parameter q required' });
      const results = await this.search(query);
      res.json({ notes: results });
    });

    app.delete('/api/notes/:id', (req, res) => {
      this.delete(parseInt(req.params.id));
      res.json({ success: true });
    });

    app.get('/api/notes/export', async (req, res) => {
      const format = req.query.format || 'json';
      const exported = await this.exportNotes(format);
      if (format === 'markdown') {
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', 'attachment; filename="jarvis-notes.md"');
      }
      res.send(exported);
    });
  }
}

module.exports = NoteService;
