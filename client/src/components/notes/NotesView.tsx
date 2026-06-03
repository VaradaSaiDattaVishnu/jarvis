import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash2, Download } from 'lucide-react';
import { useNotesStore } from '../../stores/notes';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Spinner from '../ui/Spinner';
import * as api from '../../api/endpoints';

export default function NotesView() {
  const { notes, loading, searchQuery, fetchNotes, search, addNote, remove, setSearchQuery } = useNotesStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newNote, setNewNote] = useState({ title: '', content: '', tags: '' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchNotes();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchNotes]);

  // Debounce keystrokes so we don't fire a request per character (#51).
  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (q.length >= 2) search(q);
      else if (q === '') fetchNotes();
    }, 250);
  };

  const handleCreate = async () => {
    if (!newNote.title.trim() || !newNote.content.trim()) return;
    await addNote(newNote.title, newNote.content, newNote.tags || undefined);
    setNewNote({ title: '', content: '', tags: '' });
    setShowCreate(false);
  };

  const handleExport = async () => {
    try {
      const data = await api.exportNotes();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-notes-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan text-glow-cyan">
          Notes
        </h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport} size="sm">
            <span className="flex items-center gap-1.5"><Download size={14} /> Export</span>
          </Button>
          <Button onClick={() => setShowCreate(true)} size="sm">
            <span className="flex items-center gap-1.5"><Plus size={14} /> New Note</span>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-jarvis-fg-dim" />
        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm pl-9 pr-3 py-2 text-jarvis-fg font-sans text-sm outline-none focus:border-jarvis-cyan-dim transition-colors placeholder:text-jarvis-fg-dim"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : notes.length === 0 ? (
        <div className="text-center py-12 text-jarvis-fg-dim font-mono text-sm">
          {searchQuery ? 'No notes match your search' : 'No notes yet'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {notes.map((note) => (
            <Card key={note.id} hover>
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-sans text-sm font-medium text-jarvis-fg">{note.title}</h3>
                <button
                  onClick={(e) => { e.stopPropagation(); remove(note.id); }}
                  className="text-jarvis-fg-dim hover:text-jarvis-red transition-colors p-0.5 flex-shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <p className="text-[0.8rem] text-jarvis-fg/70 line-clamp-3 mb-2">{note.content}</p>
              {note.tags && (
                <div className="flex flex-wrap gap-1">
                  {note.tags.split(',').map((tag) => (
                    <span key={tag} className="text-[0.55rem] font-mono px-1.5 py-0.5 rounded-sm bg-jarvis-cyan-glow text-jarvis-cyan border border-jarvis-cyan-dim">
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 font-mono text-[0.5rem] text-jarvis-fg-dim">
                {new Date(note.created_at).toLocaleDateString()}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Note">
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="Note title"
            value={newNote.title}
            onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
            autoFocus
          />
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim">Content</label>
            <textarea
              value={newNote.content}
              onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
              placeholder="Write your note..."
              rows={5}
              className="bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm px-3 py-2 text-jarvis-fg font-sans text-[0.85rem] outline-none focus:border-jarvis-cyan-dim transition-colors resize-none placeholder:text-jarvis-fg-dim"
            />
          </div>
          <Input
            label="Tags (comma-separated)"
            placeholder="work, idea, personal"
            value={newNote.tags}
            onChange={(e) => setNewNote({ ...newNote, tags: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newNote.title.trim() || !newNote.content.trim()}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
