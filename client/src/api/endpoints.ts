import { api } from './client';
import type {
  Task,
  Note,
  Memory,
  Relationship,
  Preference,
  CalendarEvent,
  HealthData,
  Backup,
  BriefingConfig,
  FollowUpConfig,
  FollowUp,
  Document,
  DocSearchResult,
  ProactiveSuggestion,
} from '../types';

// ─── Health ─────────────────────────────────────────────
export const getHealth = () => api.get<HealthData>('/api/health');

// ─── Tasks ──────────────────────────────────────────────
export const getTasks = (status?: string) =>
  api.get<{ tasks: Task[] }>(`/api/tasks${status ? `?status=${status}` : ''}`);
export const createTask = (content: string, priority?: string, due_date?: string, sync_calendar?: boolean) =>
  api.post<{ id: number; success: boolean; calendarSync?: { synced: boolean; eventId?: string; error?: string } }>('/api/tasks', { content, priority, due_date, sync_calendar });
export const updateTask = (id: number, data: Partial<Task>) =>
  api.put<{ success: boolean }>(`/api/tasks/${id}`, data);
export const completeTask = (id: number) =>
  api.post<{ success: boolean }>(`/api/tasks/${id}/complete`);
export const deleteTask = (id: number) =>
  api.delete<{ success: boolean }>(`/api/tasks/${id}`);

// ─── Notes ──────────────────────────────────────────────
export const getNotes = () => api.get<{ notes: Note[] }>('/api/notes');
export const createNote = (title: string, content: string, tags?: string) =>
  api.post<{ id: number; success: boolean }>('/api/notes', { title, content, tags });
export const searchNotes = (q: string) =>
  api.get<{ notes: Note[] }>(`/api/notes/search?q=${encodeURIComponent(q)}`);
export const deleteNote = (id: number) =>
  api.delete<{ success: boolean }>(`/api/notes/${id}`);
export const exportNotes = () => api.get<{ notes: Note[] }>('/api/notes/export');

// ─── Calendar ───────────────────────────────────────────
export const getTodayEvents = () =>
  api.get<{ events: CalendarEvent[] }>('/api/calendar/today');
export const getUpcomingEvents = (days = 7) =>
  api.get<{ events: CalendarEvent[] }>(`/api/calendar/upcoming?days=${days}`);
export const createEvent = (data: {
  summary: string;
  startTime: string;
  endTime?: string;
  description?: string;
  location?: string;
}) => api.post<{ success: boolean; eventId?: string }>('/api/calendar/create', data);
export const getGoogleStatus = () =>
  api.get<{ connected: boolean }>('/api/google/status');

// ─── Memory / Relationships / Entities ──────────────────
export const getRelationships = () =>
  api.get<{ relationships: Relationship[] }>('/api/relationships');
export const getPrivacyData = () =>
  api.get<{
    memories: Memory[];
    relationships: Relationship[];
    tasks: Task[];
    preferences: Preference[];
    notes: Note[];
  }>('/api/privacy/data');
export const deleteMemory = (id: number) =>
  api.delete<{ success: boolean }>(`/api/privacy/memories/${id}`);
export const forgetTopic = (topic: string) =>
  api.post<{ deleted: number; success: boolean }>('/api/privacy/forget-topic', { topic });

// ─── Email ──────────────────────────────────────────────
export const getRecentEmails = (max = 10) =>
  api.get<{ emails: unknown[] }>(`/api/email/recent?max=${max}`);
export const getUnreadCount = () =>
  api.get<{ count: number }>('/api/email/unread');
export const sendEmail = (to: string, subject: string, body: string) =>
  api.post<{ success: boolean }>('/api/email/send', { to, subject, body });

// ─── Music ──────────────────────────────────────────────
export const getSpotifyStatus = () =>
  api.get<{ authenticated: boolean }>('/api/spotify/status');
export const getNowPlaying = () => api.get<unknown>('/api/spotify/now-playing');
export const playMusic = (uri?: string) =>
  api.post<{ success: boolean }>('/api/spotify/play', uri ? { uri } : {});
export const pauseMusic = () => api.post<{ success: boolean }>('/api/spotify/pause');
export const nextTrack = () => api.post<{ success: boolean }>('/api/spotify/next');
export const searchMusic = (q: string) =>
  api.post<{ results: unknown[] }>('/api/spotify/search', { query: q });

// ─── Smart Home ─────────────────────────────────────────
export const getSmartHomeStatus = () =>
  api.get<{ connected: boolean }>('/api/smarthome/status');
export const getDevices = () =>
  api.get<{ devices: unknown[] }>('/api/smarthome/devices');
export const smartHomeAction = (action: string, entity_id: string, params?: Record<string, unknown>) =>
  api.post<{ success: boolean }>('/api/smarthome/action', { action, entity_id, ...params });

// ─── News ───────────────────────────────────────────────
export const getNews = (q?: string) =>
  api.get<{ articles: unknown[] }>(`/api/news${q ? `?q=${encodeURIComponent(q)}` : ''}`);

// ─── Briefing ───────────────────────────────────────────
export const triggerBriefing = () =>
  api.post<{ success: boolean; briefing?: string }>('/api/briefing/trigger');
export const getBriefingConfig = () => api.get<BriefingConfig>('/api/briefing/config');
export const updateBriefingConfig = (config: Partial<BriefingConfig>) =>
  api.post<{ success: boolean }>('/api/briefing/config', config);

// ─── Follow-ups ─────────────────────────────────────────
export const getFollowUps = () =>
  api.get<{ pending: FollowUp[]; due: FollowUp[] }>('/api/followups');
export const markFollowUpDone = (id: number) =>
  api.post<{ success: boolean }>(`/api/followups/${id}/done`);
export const updateFollowUpConfig = (config: Partial<FollowUpConfig>) =>
  // Server reads snake_case (server/followup.js) — map from the camelCase type (#13).
  api.post<{ success: boolean }>('/api/followups/config', {
    nudge_after_hours: config.nudgeAfterHours,
    quiet_start: config.quietStart,
    quiet_end: config.quietEnd,
  });

// ─── Backup ─────────────────────────────────────────────
export const createBackup = () =>
  api.post<{ success: boolean; filename?: string }>('/api/backup/create');
export const listBackups = () => api.get<{ backups: Backup[] }>('/api/backup/list');

// ─── Monitor ────────────────────────────────────────────
export const getMonitorHealth = () => api.get<HealthData>('/api/monitor/health');
export const getMonitorMetrics = () => api.get<unknown>('/api/monitor/metrics');

// ─── Privacy ────────────────────────────────────────────
export const goOffRecord = (sessionId: string) =>
  api.post<{ success: boolean }>('/api/privacy/off-record', { sessionId });
export const goOnRecord = (sessionId: string) =>
  api.post<{ success: boolean }>('/api/privacy/on-record', { sessionId });

// ─── Push ───────────────────────────────────────────────
export const getVapidKey = () =>
  api.get<{ publicKey: string }>('/api/vapid-public-key');
export const pushSubscribe = (subscription: PushSubscription) =>
  api.post<{ success: boolean }>('/api/push-subscribe', subscription.toJSON());
export const pushUnsubscribe = (endpoint: string) =>
  api.post<{ success: boolean }>('/api/push-unsubscribe', { endpoint });

// ─── Admin Config ───────────────────────────────────────
export const getAdminConfig = () =>
  api.get<Record<string, { configured: boolean; connected?: boolean }>>('/api/admin/config');
export const setAdminConfig = (service: string, keys: Record<string, string>) =>
  api.post<{ success: boolean; status?: string }>('/api/admin/config', { service, keys });
export const getSetupStatus = () =>
  api.get<{ needsSetup: boolean; configured: string[] }>('/api/admin/setup-status');

// ─── Documents (RAG, Feature 2) ─────────────────────────
export const getDocuments = () =>
  api.get<{ documents: Document[]; stats: { documents: number; chunks: number } }>('/api/documents');
export const addDocument = (title: string, content: string, source = 'upload') =>
  api.post<{ success: boolean; id: number; title: string; chunks: number; chars: number }>(
    '/api/documents', { title, content, source });
export const deleteDocument = (id: number) =>
  api.delete<{ success: boolean }>(`/api/documents/${id}`);
export const searchDocuments = (query: string, topK = 5) =>
  api.post<{ results: DocSearchResult[] }>('/api/documents/search', { query, topK });

// ─── Proactive Intelligence (Feature 3) ─────────────────
export const getProactiveSuggestions = () =>
  api.get<{ suggestions: ProactiveSuggestion[] }>('/api/proactive/suggestions');

// ─── Auth ───────────────────────────────────────────────
export const getAuthStatus = (sessionId?: string) =>
  api.get<{ pinSet: boolean; authenticated: boolean }>(
    `/api/auth/status${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`);
export const loginPin = (sessionId: string, pin: string) =>
  api.post<{ success: boolean; error?: string }>('/api/auth/login', { sessionId, pin });
export const setupPin = (pin: string, oldPin?: string) =>
  api.post<{ success?: boolean; error?: string }>('/api/auth/setup-pin', { pin, oldPin });
