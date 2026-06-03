import { create } from 'zustand';
import type { HealthData } from '../types';
import * as api from '../api/endpoints';

interface MonitorState {
  health: HealthData | null;
  loading: boolean;

  fetchHealth: () => Promise<void>;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  health: null,
  loading: false,

  fetchHealth: async () => {
    set({ loading: true });
    try {
      // /api/health merges getStats() (totalMemories etc.); /api/monitor/health does not.
      const health = await api.getHealth();
      set({ health, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
