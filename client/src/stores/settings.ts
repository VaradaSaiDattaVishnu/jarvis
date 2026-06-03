import { create } from 'zustand';
import type { BriefingConfig } from '../types';
import * as api from '../api/endpoints';

interface SettingsState {
  briefingConfig: BriefingConfig | null;
  noiseGateThreshold: number;
  pushEnabled: boolean;

  fetchBriefingConfig: () => Promise<void>;
  updateBriefingConfig: (config: Partial<BriefingConfig>) => Promise<void>;
  setNoiseGateThreshold: (threshold: number) => void;
  setPushEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  briefingConfig: null,
  noiseGateThreshold: 0.01,
  pushEnabled: false,

  fetchBriefingConfig: async () => {
    try {
      const config = await api.getBriefingConfig();
      set({ briefingConfig: config });
    } catch {
      // ignore
    }
  },

  updateBriefingConfig: async (config) => {
    await api.updateBriefingConfig(config);
    set((s) => ({
      briefingConfig: s.briefingConfig ? { ...s.briefingConfig, ...config } : null,
    }));
  },

  setNoiseGateThreshold: (threshold) => set({ noiseGateThreshold: threshold }),
  setPushEnabled: (enabled) => set({ pushEnabled: enabled }),
}));
