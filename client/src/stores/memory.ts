import { create } from 'zustand';
import type { Memory, Relationship, Preference } from '../types';
import * as api from '../api/endpoints';

interface MemoryState {
  memories: Memory[];
  relationships: Relationship[];
  preferences: Preference[];
  loading: boolean;

  fetchAll: () => Promise<void>;
  fetchRelationships: () => Promise<void>;
  deleteMemory: (id: number) => Promise<void>;
  forgetTopic: (topic: string) => Promise<number>;
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  memories: [],
  relationships: [],
  preferences: [],
  loading: false,

  fetchAll: async () => {
    set({ loading: true });
    try {
      const data = await api.getPrivacyData();
      set({
        memories: data.memories || [],
        relationships: data.relationships || [],
        preferences: data.preferences || [],
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  fetchRelationships: async () => {
    try {
      const { relationships } = await api.getRelationships();
      set({ relationships });
    } catch {
      // ignore
    }
  },

  deleteMemory: async (id) => {
    await api.deleteMemory(id);
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
  },

  forgetTopic: async (topic) => {
    const result = await api.forgetTopic(topic);
    get().fetchAll();
    return result.deleted;
  },
}));
