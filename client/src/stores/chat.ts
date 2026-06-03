import { create } from 'zustand';
import type { Message, CoreState, VoiceMode } from '../types';

interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  currentChunk: string;
  sessionId: string | null;
  voiceMode: VoiceMode;
  coreState: CoreState;
  selectedVoice: string;
  isSpeaking: boolean; // true while TTS audio is playing
  toolActivity: string | null; // name of the tool currently executing (for the chip)

  setSessionId: (id: string) => void;
  sendMessage: (text: string) => void;
  addMessage: (msg: Message) => void;
  appendChunk: (text: string) => void;
  startStreaming: () => void;
  completeResponse: () => void;
  interrupt: () => void;
  setCoreState: (state: CoreState) => void;
  setVoiceMode: (mode: VoiceMode) => void;
  setSelectedVoice: (voice: string) => void;
  clearCurrentChunk: () => void;
  setIsSpeaking: (speaking: boolean) => void;
  setToolActivity: (tool: string | null) => void;
}

let messageCounter = 0;

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentChunk: '',
  sessionId: null,
  voiceMode: 'cold',
  coreState: 'idle',
  selectedVoice: 'en-US-GuyNeural',
  isSpeaking: false,
  toolActivity: null,

  setSessionId: (id) => set({ sessionId: id }),

  sendMessage: (text) => {
    const msg: Message = {
      id: `msg-${++messageCounter}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  addMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  appendChunk: (text) => {
    set((s) => ({ currentChunk: s.currentChunk + text }));
  },

  startStreaming: () => {
    set({ isStreaming: true, currentChunk: '', toolActivity: null });
  },

  completeResponse: () => {
    const { currentChunk } = get();
    if (currentChunk) {
      const msg: Message = {
        id: `msg-${++messageCounter}`,
        role: 'assistant',
        text: currentChunk,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, msg],
        currentChunk: '',
        isStreaming: false,
      }));
    } else {
      set({ isStreaming: false });
    }
    set({ toolActivity: null });
  },

  interrupt: () => {
    set({ isStreaming: false, currentChunk: '', isSpeaking: false, toolActivity: null });
  },

  setCoreState: (state) => set({ coreState: state }),
  setVoiceMode: (mode) => set({ voiceMode: mode }),
  setSelectedVoice: (voice) => set({ selectedVoice: voice }),
  clearCurrentChunk: () => set({ currentChunk: '' }),
  setIsSpeaking: (speaking) => set({ isSpeaking: speaking }),
  setToolActivity: (tool) => set({ toolActivity: tool }),
}));
