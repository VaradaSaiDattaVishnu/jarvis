import { create } from 'zustand';
import type { WSStats } from '../types';

interface AppState {
  booted: boolean;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  connected: boolean;
  memoryCount: number;
  conversationCount: number;
  calendarConnected: boolean;
  authRequired: boolean;
  authenticated: boolean;
  assistantName: string;
  provider: string;

  boot: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setConnected: (connected: boolean) => void;
  setStats: (stats: WSStats) => void;
  setCalendarConnected: (connected: boolean) => void;
  setAuthRequired: (required: boolean) => void;
  setAuthenticated: (authed: boolean) => void;
  setAssistantName: (name: string) => void;
  setProvider: (provider: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  booted: false,
  sidebarOpen: false,
  sidebarCollapsed: false,
  connected: false,
  memoryCount: 0,
  conversationCount: 0,
  calendarConnected: false,
  authRequired: false,
  authenticated: false,
  assistantName: 'J.A.R.V.I.S',
  provider: '',

  boot: () => set({ booted: true }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setConnected: (connected) => set({ connected }),
  setStats: (stats) => set({
    memoryCount: stats?.totalMemories ?? 0,
    conversationCount: stats?.uniqueSessions ?? 0,
  }),
  setCalendarConnected: (connected) => set({ calendarConnected: connected }),
  setAuthRequired: (required) => set({ authRequired: required }),
  setAuthenticated: (authed) => set({ authenticated: authed }),
  setAssistantName: (name) => set({ assistantName: name }),
  setProvider: (provider) => set({ provider }),
}));
