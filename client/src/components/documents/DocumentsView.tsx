import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash2, FileText, Upload } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Spinner from '../ui/Spinner';
import { showToast } from '../ui/Toast';
import * as api from '../../api/endpoints';
import type { Document, DocSearchResult } from '../../types';

export default function DocumentsView() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const { documents } = await api.getDocuments();
      setDocuments(documents);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchDocuments();
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setDraft({ title: file.name.replace(/\.[^.]+$/, ''), content: text });
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleSave = async () => {
    if (!draft.content.trim()) return;
    setSaving(true);
    try {
      const r = await api.addDocument(draft.title.trim() || 'Untitled', draft.content);
      showToast(`📄 Indexed "${r.title}" (${r.chunks} chunks)`, 'success');
      setDraft({ title: '', content: '' });
      setShowAdd(false);
      fetchDocuments();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add document', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteDocument(id);
      fetchDocuments();
      if (results) setResults(results.filter((r) => r.docId !== id));
    } catch {
      showToast('Could not delete (PIN required?)', 'error');
    }
  };

  // Debounce keystrokes; guard against out-of-order responses with a seq token (#10).
  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults(null); setSearching(false); return; }
    debounceRef.current = setTimeout(() => runSearch(q.trim()), 250);
  };

  const runSearch = async (q: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const { results } = await api.searchDocuments(q);
      if (seq !== searchSeq.current) return; // a newer search superseded this one
      setResults(results);
    } catch {
      if (seq === searchSeq.current) setResults([]);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan text-glow-cyan">
          Documents
        </h1>
        <Button onClick={() => setShowAdd(true)} size="sm">
          <span className="flex items-center gap-1.5"><Plus size={14} /> Add Document</span>
        </Button>
      </div>
      <p className="text-[0.75rem] text-jarvis-fg-dim mb-5">
        Upload notes, docs, or references. JARVIS searches them to answer your questions with citations.
      </p>

      {/* Semantic search */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-jarvis-fg-dim" />
        <input
          type="text"
          placeholder="Ask your documents anything..."
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          className="w-full bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm pl-9 pr-3 py-2 text-jarvis-fg font-sans text-sm outline-none focus:border-jarvis-cyan-dim transition-colors placeholder:text-jarvis-fg-dim"
        />
      </div>

      {/* Search results */}
      {results !== null && (
        <div className="mb-6">
          {searching ? (
            <div className="flex items-center gap-2 text-jarvis-fg-dim text-sm py-2"><Spinner size="sm" /> Searching…</div>
          ) : results.length === 0 ? (
            <div className="text-jarvis-fg-dim font-mono text-sm py-2">No relevant passages found.</div>
          ) : (
            <div className="space-y-2">
              {results.map((r, i) => (
                <Card key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[0.6rem] tracking-wider uppercase text-jarvis-cyan">{r.title}</span>
                    {r.similarity != null && (
                      <span className="font-mono text-[0.55rem] text-jarvis-fg-dim">{Math.round(r.similarity * 100)}% match</span>
                    )}
                  </div>
                  <p className="text-[0.8rem] text-jarvis-fg/75 leading-relaxed line-clamp-4">{r.content}</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Document library */}
      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-jarvis-fg-dim font-mono text-sm">
          No documents yet. Add one to build your knowledge base.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={14} className="text-jarvis-cyan flex-shrink-0" />
                  <h3 className="font-sans text-sm font-medium text-jarvis-fg truncate">{doc.title}</h3>
                </div>
                <button
                  onClick={() => handleDelete(doc.id)}
                  className="text-jarvis-fg-dim hover:text-jarvis-red transition-colors p-0.5 flex-shrink-0"
                  title="Delete document"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider">
                {doc.chunk_count} chunks · {(doc.char_count / 1000).toFixed(1)}k chars
              </div>
              <div className="mt-1 font-mono text-[0.5rem] text-jarvis-fg-dim">
                {new Date(doc.created_at).toLocaleDateString()}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add document modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Document">
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="e.g. Project Brief"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            autoFocus
          />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim">Content</label>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1 font-mono text-[0.55rem] uppercase tracking-wider text-jarvis-cyan hover:text-jarvis-fg transition-colors"
              >
                <Upload size={11} /> Upload file
              </button>
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.text,text/*,.csv,.json" onChange={handleFile} className="hidden" />
            </div>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="Paste text here, or upload a .txt / .md file..."
              rows={8}
              className="bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm px-3 py-2 text-jarvis-fg font-sans text-[0.85rem] outline-none focus:border-jarvis-cyan-dim transition-colors resize-none placeholder:text-jarvis-fg-dim"
            />
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim text-right">
              {draft.content.length.toLocaleString()} chars
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!draft.content.trim() || saving}>
              {saving ? 'Indexing…' : 'Add'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
