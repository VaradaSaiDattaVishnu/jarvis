import { create } from 'zustand';
import type { ServiceConfig } from '../types';

interface IntegrationsState {
  services: Record<string, ServiceConfig>;
  loading: boolean;

  setServiceStatus: (key: string, configured: boolean, connected?: boolean) => void;
  setLoading: (loading: boolean) => void;
  initServices: () => void;
}

const DEFAULT_SERVICES: Record<string, ServiceConfig> = {
  groq: {
    name: 'Groq',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Fast LLM inference for conversation',
    icon: 'Cpu',
    keys: ['GROQ_API_KEY'],
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Advanced AI reasoning and conversation',
    icon: 'Brain',
    keys: ['ANTHROPIC_API_KEY'],
  },
  google: {
    name: 'Google Calendar & Gmail',
    type: 'oauth',
    configured: false,
    connected: false,
    description: 'Calendar sync, smart scheduling, and email',
    icon: 'Calendar',
    authUrl: '/api/google/auth',
    statusUrl: '/api/google/status',
    keys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  spotify: {
    name: 'Spotify',
    type: 'oauth',
    configured: false,
    connected: false,
    description: 'Music playback and mood-based recommendations',
    icon: 'Music',
    authUrl: '/api/spotify/auth',
    statusUrl: '/api/spotify/status',
    keys: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  },
  brave: {
    name: 'Brave Search',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Web search and news headlines',
    icon: 'Search',
    keys: ['BRAVE_API_KEY'],
  },
  openweather: {
    name: 'OpenWeather',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Weather forecasts and conditions',
    icon: 'Cloud',
    keys: ['OPENWEATHER_API_KEY'],
  },
  twilio: {
    name: 'Twilio',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Phone calls, SMS, and WhatsApp messaging',
    icon: 'Phone',
    keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  },
  homeassistant: {
    name: 'Home Assistant',
    type: 'apikey',
    configured: false,
    connected: false,
    description: 'Smart home device control',
    icon: 'Home',
    keys: ['HOME_ASSISTANT_URL', 'HOME_ASSISTANT_TOKEN'],
  },
};

export const useIntegrationsStore = create<IntegrationsState>((set) => ({
  services: DEFAULT_SERVICES,
  loading: false,

  setServiceStatus: (key, configured, connected) =>
    set((s) => ({
      services: {
        ...s.services,
        [key]: { ...s.services[key], configured, connected: connected ?? configured },
      },
    })),

  setLoading: (loading) => set({ loading }),

  initServices: () => set({ services: { ...DEFAULT_SERVICES } }),
}));
