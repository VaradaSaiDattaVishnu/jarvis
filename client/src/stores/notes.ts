import { create } from 'zustand';
import type { Note } from '../types';
import * as api from '../api/endpoints';

interface NotesState {
  notes: Note[];
  loading: boolean;
  searchQuery: string;

  fetchNotes: () => Promise<void>;
  search: (q: string) => Promise<void>;
  addNote: (title: string, content: string, tags?: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setSearchQuery: (q: string) => void;
}

// Monotonic token so a slow earlier search can't clobber a faster later one (#51).
let searchSeq = 0;

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  loading: false,
  searchQuery: '',

  fetchNotes: async () => {
    const seq = ++searchSeq;
    set({ loading: true });
    try {
      const { notes } = await api.getNotes();
      if (seq !== searchSeq) return; // a newer request superseded this one
      set({ notes, loading: false });
    } catch {
      if (seq === searchSeq) set({ loading: false });
    }
  },

  search: async (q) => {
    const seq = ++searchSeq;
    set({ loading: true, searchQuery: q });
    try {
      const { notes } = q ? await api.searchNotes(q) : await api.getNotes();
      if (seq !== searchSeq) return; // stale response — discard
      set({ notes, loading: false });
    } catch {
      if (seq === searchSeq) set({ loading: false });
    }
  },

  addNote: async (title, content, tags) => {
    await api.createNote(title, content, tags);
    get().fetchNotes();
  },

  remove: async (id) => {
    await api.deleteNote(id);
    get().fetchNotes();
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
}));
