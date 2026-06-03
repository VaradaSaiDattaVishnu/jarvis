// ─── Chat Types ─────────────────────────────────────────
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

export type CoreState = 'idle' | 'passive' | 'active' | 'thinking' | 'speaking';
export type VoiceMode = 'cold' | 'conversation';

// ─── WebSocket Protocol ─────────────────────────────────
// Matches the server's getStats() payload.
export interface WSStats {
  totalMessages: number;
  totalMemories: number;
  uniqueSessions: number;
  pendingReminders: number;
}

export interface WSConnectedPayload {
  sessionId: string;
  stats: WSStats;
  name: string;
  provider: string;
  authRequired: boolean;
  calendarConnected: boolean;
}

export interface WSTextChunkPayload {
  text: string;
}

export interface WSAudioPayload {
  url: string;
  index: number;
}

export interface WSReminderPayload {
  content: string;
  id: number;
}

export interface WSFollowUpPayload {
  topic: string;
  context: string;
  id: number;
}

export interface WSToolPayload {
  name: string;
  status: 'start' | 'done';
}

export type WSMessage =
  | ({ type: 'connected' } & WSConnectedPayload)
  | { type: 'thinking' }
  | ({ type: 'text_chunk' } & WSTextChunkPayload)
  | ({ type: 'audio' } & WSAudioPayload)
  | { type: 'response_complete' }
  | { type: 'interrupted' }
  | { type: 'error'; message: string }
  | { type: 'voice_changed'; voice: string }
  | ({ type: 'reminder' } & WSReminderPayload)
  | ({ type: 'follow_up' } & WSFollowUpPayload)
  | ({ type: 'tool' } & WSToolPayload)
  | { type: 'auth_required'; message?: string }
  | { type: 'auth_result'; success: boolean; error?: string; message?: string };

// ─── Task Types ─────────────────────────────────────────
export interface Task {
  id: number;
  content: string;
  status: 'pending' | 'in_progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  calendar_event_id: string | null;
  created_at: string;
}

// ─── Note Types ─────────────────────────────────────────
export interface Note {
  id: number;
  title: string;
  content: string;
  tags: string;
  created_at: string;
}

// ─── Memory Types ───────────────────────────────────────
export interface Memory {
  id: number;
  category: string;
  content: string;
  keywords: string;
  importance: number;
  created_at: string;
}

export interface Relationship {
  id: number;
  person_name: string;
  relationship_type: string;
  context: string;
  mention_count: number;
}

export interface Entity {
  id: number;
  name: string;
  type: string;
  attributes: string;
  related_entities: string;
}

export interface Preference {
  id: number;
  category: string;
  preference: string;
  source: string;
  confidence: number;
}

// ─── Calendar Types ─────────────────────────────────────
export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  allDay: boolean;
}

// ─── Integration Types ──────────────────────────────────
export interface ServiceConfig {
  name: string;
  type: 'oauth' | 'apikey';
  configured: boolean;
  connected: boolean;
  description: string;
  icon: string;
  authUrl?: string;
  statusUrl?: string;
  keys?: string[];
}

// ─── Monitor Types ──────────────────────────────────────
// Matches the server's monitor.getHealth() shape exactly (uptime is a STRING
// like "1.3h"; latencies are *LatencyMs; errorRate is a string like "0%").
export interface HealthData {
  status: string;
  uptime: string;
  uptimeMs: number;
  llm: {
    totalRequests: number;
    errors: number;
    errorRate: string;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  tts: {
    totalRequests: number;
    errors: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  websocket: { connections: number; messages: number };
  memory: { extractions: number; searches: number };
  timestamp: string;
  // Present only on /api/health (getStats merged), not /api/monitor/health.
  totalMessages?: number;
  totalMemories?: number;
  uniqueSessions?: number;
  pendingReminders?: number;
}

// ─── Document (RAG) Types ───────────────────────────────
export interface Document {
  id: number;
  title: string;
  source: string;
  char_count: number;
  chunk_count: number;
  created_at: string;
}

export interface DocSearchResult {
  docId: number;
  title: string;
  content: string;
  similarity: number | null;
}

// ─── Proactive Intelligence ─────────────────────────────
export interface ProactiveSuggestion {
  title: string;
  detail: string;
  priority: 'low' | 'medium' | 'high';
}

// ─── Follow-up ──────────────────────────────────────────
export interface FollowUp {
  id: number;
  topic: string;
  context: string;
  check_after: string;
  status: string;
  created_at: string;
}

// ─── Backup Types ───────────────────────────────────────
export interface Backup {
  filename: string;
  size: number;
  created: string;
}

// ─── Briefing Config ────────────────────────────────────
export interface BriefingConfig {
  enabled: boolean;
  time: string;
  delivery: string;
}

// ─── Follow-up Config ───────────────────────────────────
export interface FollowUpConfig {
  nudgeAfterHours: number;
  quietStart: number;
  quietEnd: number;
}
