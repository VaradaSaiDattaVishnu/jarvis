require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const LLMService = require('./llm');
const TTSService = require('./tts');
const MemoryService = require('./memory');
const ReminderService = require('./reminders');
const PushService = require('./push');
const MoodService = require('./mood');
const SearchService = require('./search');
const CalendarService = require('./calendar');
const PhoneService = require('./phone');
const SpeakerService = require('./speaker');
const AuthService = require('./auth');
const BriefingService = require('./briefing');
const FollowUpService = require('./followup');
const NewsService = require('./news');
const EmailService = require('./email');
const SmartHomeService = require('./smarthome');
const MusicService = require('./music');
const NoteService = require('./notes');
const PrivacyService = require('./privacy');
const BackupService = require('./backup');
const MonitorService = require('./monitor');
const RAGService = require('./rag');
const { buildTools } = require('./tools');
const personality = require('./personality.json');

// ─── Init Memory FIRST + hydrate persisted config ───────
// Integration keys saved through the setup wizard are persisted to the DB
// (app_config) so they survive even when the filesystem is ephemeral (e.g. a
// Railway container without a writable .env). Load them into process.env for any
// var that isn't already set, BEFORE constructing the services that read them.
const memory = new MemoryService();
try {
  const savedConfig = memory.getAppConfig();
  let hydrated = 0;
  for (const [k, v] of Object.entries(savedConfig)) {
    if (v && !process.env[k]) { process.env[k] = v; hydrated++; }
  }
  if (hydrated) console.log(`🔑 Hydrated ${hydrated} persisted config key(s) from DB`);
} catch (e) {
  console.error('⚠️ Could not load persisted config:', e.message);
}

// ─── Init Services ───────────────────────────────────────
const llm = new LLMService({
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  groqKey: process.env.GROQ_API_KEY,
});
const tts = new TTSService(process.env.JARVIS_VOICE || personality.voiceId);
const reminders = new ReminderService(memory);
const push = new PushService(memory);
const mood = new MoodService(memory.db);
const search = new SearchService();
const calendar = new CalendarService();
const speaker = new SpeakerService(memory.db);
const auth = new AuthService(memory.db);
const phone = new PhoneService({
  ttsService: tts,
  llmService: llm,
  memoryService: memory,
  personality,
});
const news = new NewsService({ searchService: search });
const email = new EmailService({ calendarService: calendar });
const smarthome = new SmartHomeService();
const music = new MusicService();
const notes = new NoteService({ memoryService: memory });
const privacy = new PrivacyService({ memoryService: memory });
const backup = new BackupService({ memoryService: memory });
const monitor = new MonitorService();
const rag = new RAGService({ memoryService: memory });

// Connected WebSocket clients (shared with proactive services for live delivery).
const connectedClients = new Set();
const briefing = new BriefingService({
  memoryService: memory,
  calendarService: calendar,
  searchService: search,
  llmService: llm,
  pushService: push,
  personality,
});
const followUp = new FollowUpService({
  memoryService: memory,
  llmService: llm,
  pushService: push,
  connectedClients,
});

// When Google auth state flips (OAuth callback / token refresh), Gmail rides the
// same OAuth client — rebind it so email tools light up without a restart (#6).
calendar.onAuthChange = () => {
  try { email.reinit(); } catch (e) { console.error('email.reinit failed:', e.message); }
};

// Voices the user is allowed to switch to (edge-tts neural voices). Anything else
// is rejected so set_voice can't be used to inject arbitrary spawn args (#21).
const ALLOWED_VOICES = new Set([
  'en-US-GuyNeural', 'en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-DavisNeural',
  'en-US-AndrewNeural', 'en-US-BrianNeural', 'en-US-EmmaNeural', 'en-US-MichelleNeural',
  'en-US-RogerNeural', 'en-US-SteffanNeural', 'en-US-ChristopherNeural', 'en-US-EricNeural',
  'en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-GB-LibbyNeural',
  'en-AU-WilliamNeural', 'en-AU-NatashaNeural',
  'en-IN-PrabhatNeural', 'en-IN-NeerjaNeural',
]);

const PORT = process.env.PORT || 3000;

// ─── Express Server ──────────────────────────────────────
const app = express();
const server = http.createServer(app);

// Behind Railway/any reverse proxy: trust X-Forwarded-* so req protocol/ip are
// correct (also matters for Twilio signature validation building public URLs).
app.set('trust proxy', true);

app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Twilio webhooks send form data

// CORS for Vite dev server
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-session-id');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
}

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/audio', express.static(path.join(__dirname, '..', 'audio')));

// Auth guard — applied to sensitive routes. No-op when no PIN is set (open mode).
const guard = auth.requireAuth();

// Health check (enhanced with monitoring)
app.get('/api/health', (req, res) => {
  const stats = memory.getStats();
  const health = monitor.getHealth();
  res.json({ ...health, ...stats });
});

// VAPID public key for push subscription
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.vapidPublicKey });
});

// Push subscription
app.post('/api/push-subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }
  push.subscribe(subscription);
  res.json({ success: true });
});

// Push unsubscribe
app.post('/api/push-unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) push.unsubscribe(endpoint);
  res.json({ success: true });
});

// ─── Register service routes ────────────────────────────
calendar.setupRoutes(app);
// Register phone routes UNCONDITIONALLY — they 503 until Twilio is configured and
// light up after the setup wizard saves creds + phone.reload(), no restart (#4).
phone.setupRoutes(app);
speaker.setupRoutes(app);
auth.setupRoutes(app);
news.setupRoutes(app);
// Register email routes UNCONDITIONALLY — they can become ready after a Google
// OAuth link at runtime, and each handler guards on email.ready itself (#5).
email.setupRoutes(app);
music.setupRoutes(app);
notes.setupRoutes(app);
monitor.setupRoutes(app);
rag.setupRoutes(app, guard); // mutating document routes are auth-gated inside

// ── Auth gating (#1) ──────────────────────────────────────
// A guard must be mounted BEFORE the route it protects (Express runs handlers in
// registration order). No-op when no PIN is set, so it's a safe default.
app.use('/api/smarthome/action', guard);
smarthome.setupRoutes(app);

app.use('/api/privacy', guard);
privacy.setupRoutes(app);

app.use('/api/backup', guard);
backup.setupRoutes(app);

// Proactive services' HTTP routes — MUST be registered before the SPA catch-all
// below, or GET /api/followups and /api/briefing/* get shadowed by it.
briefing.setupRoutes(app);
followUp.setupRoutes(app);

// Calendar events API (for frontend)
app.get('/api/calendar/today', async (req, res) => {
  const events = await calendar.getTodayEvents();
  res.json({ events });
});

app.get('/api/calendar/upcoming', async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const events = await calendar.getUpcomingEvents(days);
  res.json({ events });
});

app.post('/api/calendar/create', async (req, res) => {
  const result = await calendar.createEvent(req.body);
  res.json(result);
});

// ─── Task API endpoints ─────────────────────────────────
app.get('/api/tasks', (req, res) => {
  const status = req.query.status || null;
  res.json({ tasks: memory.getTasks(status) });
});
app.post('/api/tasks', async (req, res) => {
  const { content, priority, due_date, sync_calendar } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const id = memory.createTask(content, priority || 'medium', due_date || null);

  // Auto-sync to Google Calendar if due_date provided and calendar is connected
  let calendarSync = null;
  if (due_date && calendar.ready && sync_calendar !== false) {
    try {
      const startTime = new Date(due_date);
      // If date-only (no time component), set to 9:00 AM
      if (due_date.length <= 10) {
        startTime.setHours(9, 0, 0, 0);
      }
      const result = await calendar.createEvent({
        summary: `[Task] ${content}`,
        startTime: startTime.toISOString(),
        description: `JARVIS Task — Priority: ${priority || 'medium'}\nCreated from Tasks module`,
      });
      if (result.success) {
        memory.setTaskCalendarEvent(id, result.eventId);
        calendarSync = { synced: true, eventId: result.eventId, link: result.link };
        console.log(`📅 Task #${id} synced to calendar: ${result.eventId}`);
      } else {
        calendarSync = { synced: false, error: result.error };
      }
    } catch (e) {
      calendarSync = { synced: false, error: e.message };
    }
  }

  res.json({ id, success: true, calendarSync });
});

app.put('/api/tasks/:id', async (req, res) => {
  const taskId = parseInt(req.params.id);
  const existing = memory.getTask(taskId);
  memory.updateTask(taskId, req.body);

  // If due_date changed and calendar is connected, sync the event
  let calendarSync = null;
  if (req.body.due_date !== undefined && calendar.ready) {
    const newDueDate = req.body.due_date;
    if (newDueDate && !existing?.calendar_event_id) {
      // New due date, no existing event — create one
      try {
        const startTime = new Date(newDueDate);
        if (newDueDate.length <= 10) startTime.setHours(9, 0, 0, 0);
        const result = await calendar.createEvent({
          summary: `[Task] ${req.body.content || existing?.content || 'Task'}`,
          startTime: startTime.toISOString(),
          description: `JARVIS Task — Priority: ${req.body.priority || existing?.priority || 'medium'}\nCreated from Tasks module`,
        });
        if (result.success) {
          memory.setTaskCalendarEvent(taskId, result.eventId);
          calendarSync = { synced: true, eventId: result.eventId };
        }
      } catch (e) {
        calendarSync = { synced: false, error: e.message };
      }
    } else if (!newDueDate && existing?.calendar_event_id) {
      // Due date removed — delete the calendar event
      try {
        await calendar.deleteEvent(existing.calendar_event_id);
        memory.setTaskCalendarEvent(taskId, null);
        calendarSync = { synced: false, removed: true };
      } catch (e) { /* best effort */ }
    }
  }

  res.json({ success: true, calendarSync });
});

app.post('/api/tasks/:id/complete', async (req, res) => {
  const taskId = parseInt(req.params.id);
  const task = memory.getTask(taskId);
  memory.completeTask(taskId);

  // Optionally delete calendar event when task is completed
  if (task?.calendar_event_id && calendar.ready) {
    try {
      await calendar.deleteEvent(task.calendar_event_id);
      memory.setTaskCalendarEvent(taskId, null);
    } catch (e) { /* best effort cleanup */ }
  }

  res.json({ success: true });
});

app.delete('/api/tasks/:id', async (req, res) => {
  const taskId = parseInt(req.params.id);
  const task = memory.getTask(taskId);

  // Delete associated calendar event
  if (task?.calendar_event_id && calendar.ready) {
    try {
      await calendar.deleteEvent(task.calendar_event_id);
    } catch (e) { /* best effort cleanup */ }
  }

  memory.deleteTask(taskId);
  res.json({ success: true });
});

// ─── Notes API endpoints ────────────────────────────────
app.get('/api/notes', (req, res) => {
  res.json({ notes: memory.getAllNotes() });
});
app.post('/api/notes', async (req, res) => {
  const { title, content, tags } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });
  const id = await memory.saveNote(title || null, content, tags || '');
  res.json({ id, success: true });
});
app.get('/api/notes/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Query parameter q required' });
  const results = await memory.searchNotes(query);
  res.json({ notes: results });
});
app.get('/api/notes/export', (req, res) => {
  res.json({ notes: memory.getAllNotes() });
});
app.delete('/api/notes/:id', (req, res) => {
  memory.deleteNote(parseInt(req.params.id));
  res.json({ success: true });
});

// ─── Relationships API endpoint ─────────────────────────
app.get('/api/relationships', (req, res) => {
  res.json({ relationships: memory.getRelationships() });
});

// ─── Proactive Intelligence (Feature 3) ─────────────────
// Anticipatory suggestions the assistant surfaces without being asked.
app.get('/api/proactive/suggestions', async (req, res) => {
  try {
    const result = await briefing.generateProactiveInsights();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message, suggestions: [] });
  }
});

// ─── Admin Config API (for frontend setup wizard) ───────
const ENV_PATH = path.join(__dirname, '..', '.env');

const SERVICE_ENV_MAP = {
  groq: ['GROQ_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  spotify: ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
  // search.js reads BRAVE_SEARCH_API_KEY — keep this name in sync (was BRAVE_API_KEY).
  brave: ['BRAVE_SEARCH_API_KEY'],
  openweather: ['OPENWEATHER_API_KEY'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  homeassistant: ['HOME_ASSISTANT_URL', 'HOME_ASSISTANT_TOKEN'],
};

app.get('/api/admin/config', (req, res) => {
  // Helper: check if a value looks like a real key (not a placeholder)
  const isRealValue = (v) => v && v.length > 5 && !v.includes('your-') && !v.includes('-here') && !v.includes('xxx');

  const config = {};
  for (const [svc, envKeys] of Object.entries(SERVICE_ENV_MAP)) {
    const configured = envKeys.every(k => isRealValue(process.env[k]));
    let connected = false;
    // Services with runtime connection state
    if (svc === 'google') connected = calendar.ready;
    else if (svc === 'spotify') connected = music.ready;
    else if (svc === 'homeassistant') connected = smarthome.ready;
    // API key services — "configured" is the best we know (keys were validated on save)
    else connected = configured;
    config[svc] = { configured, connected };
  }
  res.json(config);
});

app.get('/api/admin/setup-status', (req, res) => {
  const hasLLM = !!(process.env.GROQ_API_KEY || process.env.ANTHROPIC_API_KEY);
  const configured = Object.entries(SERVICE_ENV_MAP)
    .filter(([, keys]) => keys.every(k => !!process.env[k]))
    .map(([svc]) => svc);
  res.json({ needsSetup: !hasLLM, configured });
});

app.post('/api/admin/config', async (req, res) => {
  const { service, keys } = req.body;
  if (!service || !keys || !SERVICE_ENV_MAP[service]) {
    return res.status(400).json({ error: 'Invalid service or keys' });
  }

  const expectedKeys = SERVICE_ENV_MAP[service];
  for (const k of expectedKeys) {
    if (!keys[k]) return res.status(400).json({ error: `Missing key: ${k}` });
  }

  // ─── Validate the key actually works before saving ─────
  try {
    await validateServiceKey(service, keys);
  } catch (e) {
    return res.status(400).json({ error: e.message, service });
  }

  try {
    // Read current .env (best effort — filesystem may be read-only in prod)
    let envContent = '';
    if (fs.existsSync(ENV_PATH)) {
      envContent = fs.readFileSync(ENV_PATH, 'utf8');
    }

    // Update or add each key
    for (const [key, value] of Object.entries(keys)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
      // Update process.env immediately AND persist to the DB so the key survives
      // restarts even when .env isn't writable (#18).
      process.env[key] = value;
      try { memory.setAppConfig(key, value); } catch (e) { /* DB persist best effort */ }
    }

    try {
      fs.writeFileSync(ENV_PATH, envContent.trim() + '\n');
    } catch (e) {
      console.warn('⚠️ Could not write .env (using DB-persisted config instead):', e.message);
    }

    // Reload affected services with new credentials
    if (service === 'google') {
      calendar.reloadCredentials();
    } else if (service === 'brave' || service === 'openweather') {
      search.braveKey = process.env.BRAVE_SEARCH_API_KEY;
      search.weatherKey = process.env.OPENWEATHER_API_KEY;
    } else if (service === 'twilio') {
      phone.reload(); // mount-and-go: routes were already registered (#4)
    }

    res.json({ success: true, service, status: 'configured' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Key Validation: actually test each API key ─────────
async function validateServiceKey(service, keys) {
  const https = require('https');

  const httpGet = (url, headers = {}) => new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('Invalid API key — authentication failed'));
        else reject(new Error(`API returned HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out — check the key and try again')); });
  });

  const httpPost = (url, postData, headers = {}) => new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(postData), ...headers },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else if (res.statusCode === 401 || res.statusCode === 403) reject(new Error('Invalid API key — authentication failed'));
        else if (res.statusCode === 400) resolve(body); // Bad request body but key is valid
        else reject(new Error(`API returned HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(postData);
    req.end();
  });

  switch (service) {
    case 'groq': {
      await httpGet('https://api.groq.com/openai/v1/models', {
        'Authorization': `Bearer ${keys.GROQ_API_KEY}`,
      });
      break;
    }
    case 'anthropic': {
      await httpPost('https://api.anthropic.com/v1/messages',
        JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        {
          'x-api-key': keys.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }
      );
      break;
    }
    case 'brave': {
      await httpGet('https://api.search.brave.com/res/v1/web/search?q=test&count=1', {
        'Accept': 'application/json',
        'X-Subscription-Token': keys.BRAVE_SEARCH_API_KEY,
      });
      break;
    }
    case 'openweather': {
      await httpGet(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${keys.OPENWEATHER_API_KEY}`);
      break;
    }
    case 'google': {
      if (!keys.GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) {
        throw new Error('Invalid Google Client ID — it should end with .apps.googleusercontent.com');
      }
      if (keys.GOOGLE_CLIENT_SECRET.length < 10) {
        throw new Error('Google Client Secret seems too short');
      }
      // Validate credentials by attempting a dummy token exchange with Google
      // Invalid client_id/secret → Google returns 401 ("invalid_client")
      // Valid credentials + dummy code → Google returns 400 ("invalid_grant") — expected
      const postData = `client_id=${encodeURIComponent(keys.GOOGLE_CLIENT_ID)}&client_secret=${encodeURIComponent(keys.GOOGLE_CLIENT_SECRET)}&code=dummy_validation_code&grant_type=authorization_code&redirect_uri=${encodeURIComponent('http://localhost:3000/api/google/callback')}`;
      try {
        const body = await httpPost('https://oauth2.googleapis.com/token', postData, {
          'Content-Type': 'application/x-www-form-urlencoded',
        });
        // If it resolves (400 → treated as success), check response body for invalid_client
        if (typeof body === 'string' && body.includes('invalid_client')) {
          throw new Error('invalid_client');
        }
        // Otherwise body contains "invalid_grant" or "redirect_uri_mismatch" = creds are valid
      } catch (e) {
        const msg = e.message || '';
        // httpPost rejects for 401/403 with "Invalid API key" — this means invalid_client
        if (msg.includes('Invalid API key') || msg.includes('authentication failed') || msg.includes('invalid_client')) {
          throw new Error('Invalid Google OAuth credentials — the Client ID or Client Secret was not recognized by Google. Double-check them in your Google Cloud Console.');
        }
        // Any other error (timeout, network) — throw as-is
        if (msg.includes('timed out') || msg.includes('ENOTFOUND')) {
          throw e;
        }
        // "invalid_grant", "redirect_uri_mismatch" etc. = credentials are valid, just dummy code
      }
      break;
    }
    case 'spotify': {
      const creds = Buffer.from(`${keys.SPOTIFY_CLIENT_ID}:${keys.SPOTIFY_CLIENT_SECRET}`).toString('base64');
      await httpPost('https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      break;
    }
    case 'twilio': {
      await httpGet(`https://api.twilio.com/2010-04-01/Accounts/${keys.TWILIO_ACCOUNT_SID}.json`, {
        'Authorization': 'Basic ' + Buffer.from(`${keys.TWILIO_ACCOUNT_SID}:${keys.TWILIO_AUTH_TOKEN}`).toString('base64'),
      });
      break;
    }
    case 'homeassistant': {
      const url = keys.HOME_ASSISTANT_URL.replace(/\/+$/, '');
      await httpGet(`${url}/api/`, { 'Authorization': `Bearer ${keys.HOME_ASSISTANT_TOKEN}` });
      break;
    }
    default:
      throw new Error(`Unknown service: ${service}`);
  }
}

// ─── SPA Fallback (must be AFTER all /api routes) ───────
app.get('*', (req, res) => {
  // Don't serve HTML for API routes or audio
  if (req.path.startsWith('/api') || req.path.startsWith('/audio')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Reminder Callback ──────────────────────────────────
reminders.start((reminder) => {
  console.log(`⏰ Reminder triggered: "${reminder.content}"`);

  let delivered = false;
  for (const ws of connectedClients) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'reminder',
        content: reminder.content,
        id: reminder.id,
      }));
      delivered = true;
    }
  }

  if (!delivered) {
    push.sendReminder(reminder).catch(e =>
      console.error('Push notification failed:', e.message)
    );
  }
});

// ─── Agent system-prompt augmentation ───────────────────
// Teaches the model HOW to wield its tools and forbids hallucinating actions.
const TOOLS_GUIDE = `

[YOUR CAPABILITIES — TOOL USE]
You can take real actions through tools. Use them instead of guessing or pretending:
- To set reminders, create/complete tasks, take notes — call the matching tool.
- For anything current, factual, or that you're unsure about (news, prices, events, people, weather) — use web_search / get_weather / get_news rather than answering from memory.
- To answer questions about the user's own uploaded files, use search_documents and cite the source title.
- For the user's calendar, email, smart home, or music — use those tools (only offered when connected).
- If the user asks what you can do or whether you can access a service, call get_integration_status and answer truthfully.

Rules:
1. NEVER claim you performed an action (set a reminder, sent an email, created an event) unless the tool returned success. Report what actually happened.
2. If a capability isn't available (no matching tool), say so plainly and suggest connecting it in Integrations — don't pretend.
3. Keep spoken answers natural and concise; you are a voice assistant. Don't read out raw URLs or JSON.
4. When you cite web or document results, weave the source in naturally.`;

// ─── WebSocket Server ────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const sessionId = uuidv4();
  let isProcessing = false;
  let abortController = null;
  let currentPartialResponse = '';

  connectedClients.add(ws);
  monitor.recordConnection();
  console.log(`\n🟢 Client connected [${sessionId.slice(0, 8)}]`);

  const stats = memory.getStats();
  ws.send(JSON.stringify({
    type: 'connected',
    sessionId,
    stats,
    name: personality.name,
    provider: llm.displayName,
    authRequired: auth.pinSet,
    calendarConnected: calendar.ready,
  }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch { return; }

    // ─── Handle interrupt (barge-in support) ────
    // Just abort the in-flight request and persist its partial. We deliberately
    // do NOT clear isProcessing/abortController here — the owning request's
    // finally does that (guarded by identity) so a late-arriving abort can't
    // stomp a freshly-started turn (#2, #3).
    if (msg.type === 'interrupt') {
      if (abortController) abortController.abort();
      if (currentPartialResponse) {
        memory.saveMessage(sessionId, 'assistant', currentPartialResponse + ' [interrupted by user]');
        console.log(`⚡ Interrupted after: "${currentPartialResponse.slice(0, 60)}..."`);
        currentPartialResponse = '';
      }
      ws.send(JSON.stringify({ type: 'interrupted' }));
      return;
    }

    // ─── Authenticate this WS session with a PIN ───
    if (msg.type === 'authenticate') {
      const result = auth.authenticate(sessionId, msg.pin);
      ws.send(JSON.stringify({ type: 'auth_result', ...result }));
      return;
    }

    // ─── Handle voice change (validated against allowlist, #21) ───
    if (msg.type === 'set_voice') {
      if (typeof msg.voice === 'string' && ALLOWED_VOICES.has(msg.voice)) {
        tts.setVoice(msg.voice);
        // Persist so the choice survives a restart (hydrated into JARVIS_VOICE
        // before TTSService is constructed). Makes the setup wizard durable.
        try { memory.setAppConfig('JARVIS_VOICE', msg.voice); } catch { /* best effort */ }
        ws.send(JSON.stringify({ type: 'voice_changed', voice: msg.voice }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: `Unknown voice: ${msg.voice}` }));
      }
      return;
    }

    // ─── Handle user message ───────────────────
    if (msg.type === 'message' && msg.text) {
      // Gate the brain behind auth when a PIN is set (#1).
      if (auth.pinSet && !auth.isAuthenticated(sessionId)) {
        ws.send(JSON.stringify({ type: 'auth_required', message: 'Enter your PIN to continue.' }));
        return;
      }

      if (isProcessing) return;
      isProcessing = true;
      const myController = new AbortController();
      abortController = myController;

      const userText = msg.text.trim();
      console.log(`\n👤 User: ${userText}`);
      monitor.recordMessage();
      followUp.recordInteraction();

      // ─── Privacy: handle off-the-record & forget commands ───
      const privacyIntent = privacy.detectPrivacyIntent(userText);
      if (privacyIntent) {
        let privacyMsg = '';
        switch (privacyIntent.action) {
          case 'forget_last':
            privacy.forgetLastExchange(sessionId);
            privacyMsg = 'Done — I\'ve forgotten that.';
            break;
          case 'forget_topic': {
            const result = privacy.forgetTopic(privacyIntent.topic);
            privacyMsg = `Done — I've forgotten everything about "${privacyIntent.topic}" (${result.deleted} memories removed).`;
            break;
          }
          case 'off_record':
            privacy.goOffTheRecord(sessionId);
            privacyMsg = 'Going off the record. I won\'t remember anything until you say "back on the record."';
            break;
          case 'on_record':
            privacy.goOnTheRecord(sessionId);
            privacyMsg = 'Back on the record. I\'ll remember things normally now.';
            break;
        }
        if (privacyMsg) {
          // Emit 'thinking' first so the client resets its audio-queue cursor for
          // this reply (this fast-path doesn't go through the normal stream) (#6).
          ws.send(JSON.stringify({ type: 'thinking' }));
          ws.send(JSON.stringify({ type: 'text_chunk', text: privacyMsg }));
          // Synthesize BEFORE completing so the client has audio ready and the
          // lock is held until the spoken reply is actually available (#20).
          try {
            const { filename } = await tts.synthesize(privacyMsg);
            ws.send(JSON.stringify({ type: 'audio', url: `/audio/${filename}`, index: 0 }));
          } catch { /* text already sent */ }
          ws.send(JSON.stringify({ type: 'response_complete' }));
          if (abortController === myController) { abortController = null; isProcessing = false; }
          return;
        }
      }

      // Save message (skip if off the record)
      if (!privacy.isOffTheRecord(sessionId)) {
        memory.saveMessage(sessionId, 'user', userText);
      }

      currentPartialResponse = '';
      let fullResponse = '';
      let sentenceBuffer = '';
      let sentenceIndex = 0;
      const ttsPromises = [];

      // Speak a chunk of text via TTS and stream the audio URL to the client.
      const speak = (textToSpeak) => {
        const clean = textToSpeak.trim();
        if (clean.length < 3) return;
        const idx = sentenceIndex++;
        const p = tts.synthesize(clean).then(({ filename }) => {
          if (!myController.signal.aborted) {
            ws.send(JSON.stringify({ type: 'audio', url: `/audio/${filename}`, index: idx }));
          }
        }).catch(e => console.error('TTS error:', e.message));
        ttsPromises.push(p);
      };

      try {
        // ─── Ambient context (memory/profile/mood/reminders/phase4) ───
        // Real-time data (web/weather/calendar/email/news) now comes from tools,
        // so we no longer pre-fetch it with brittle regex intent detection.
        const relevantMemories = await memory.searchMemories(userText);
        const recentMessages = memory.getRecentMessages(sessionId);
        const profileText = memory.getFormattedProfile();
        const moodContext = mood.getMoodContext();

        const upcoming = reminders.list(5);
        let remindersContext = '';
        if (upcoming.length > 0) {
          remindersContext = '\n\n[UPCOMING REMINDERS]\n' +
            upcoming.map(r => `- "${r.content}" at ${r.trigger_time}${r.recurrence ? ` (${r.recurrence})` : ''}`).join('\n');
        }

        let memoryContext = '';
        if (relevantMemories.length > 0) {
          memoryContext = '\n\n[MEMORIES FROM PAST CONVERSATIONS]\n' +
            relevantMemories.map(m => `- ${m.content}`).join('\n');
        }
        if (profileText) {
          memoryContext += '\n\n[USER PROFILE]\n' + profileText;
        }

        // Phase 4 context sections
        const relationshipsText = memory.getFormattedRelationships();
        const tasksText = memory.getFormattedTasks();
        const preferencesText = memory.getFormattedPreferences();
        const routinesText = memory.getFormattedRoutines();
        const summariesText = memory.getFormattedSummaries();
        const followUpsText = memory.getFormattedFollowUps();

        let phase4Context = '';
        if (relationshipsText) phase4Context += '\n\n[PEOPLE YOU KNOW]\n' + relationshipsText;
        if (tasksText) phase4Context += '\n\n[YOUR TASKS]\n' + tasksText;
        if (preferencesText) phase4Context += '\n\n[USER PREFERENCES]\n' + preferencesText;
        if (routinesText) phase4Context += '\n\n[DETECTED ROUTINES]\n' + routinesText;
        if (summariesText) phase4Context += '\n\n[RECENT CONVERSATION SUMMARIES]\n' + summariesText;
        if (followUpsText) phase4Context += '\n\n[FOLLOW-UP]\n' + followUpsText;

        // System prompt assembly with size management.
        const MAX_PROMPT_CHARS = 12000;
        const basePrompt = personality.systemPrompt + `\n\nCurrent time: ${new Date().toLocaleString()}` + TOOLS_GUIDE;

        const sections = [memoryContext, moodContext, remindersContext, phase4Context];
        let systemPrompt = basePrompt;
        for (const section of sections) {
          if (!section) continue;
          if (systemPrompt.length + section.length <= MAX_PROMPT_CHARS) {
            systemPrompt += section;
          } else {
            const remaining = MAX_PROMPT_CHARS - systemPrompt.length;
            if (remaining > 100) systemPrompt += section.slice(0, remaining) + '\n[...truncated]';
            break;
          }
        }

        const messages = recentMessages.map(m => ({ role: m.role, content: m.content }));

        // ─── Set TTS emotion based on user mood ───
        const currentMood = mood.getCurrentMood();
        if (currentMood) {
          const moodToEmotion = {
            happy: 'happy', excited: 'excited', grateful: 'happy',
            sad: 'empathetic', anxious: 'calm', stressed: 'calm',
            angry: 'calm', frustrated: 'empathetic',
            curious: 'neutral', neutral: 'neutral',
            confused: 'calm', tired: 'calm',
          };
          tts.setEmotion(moodToEmotion[currentMood.mood] || 'neutral');
        }

        // ─── Agentic stream: text + tool calls (Feature 1) ───
        const { tools, execute } = buildTools({ memory, reminders, calendar, search, news, email, smarthome, music, rag, llm });

        ws.send(JSON.stringify({ type: 'thinking' }));

        const stream = llm.agentStream(systemPrompt, messages, tools, execute, myController.signal);

        for await (const ev of stream) {
          if (myController.signal.aborted) break;

          if (ev.type === 'text') {
            fullResponse += ev.text;
            currentPartialResponse = fullResponse;
            sentenceBuffer += ev.text;
            ws.send(JSON.stringify({ type: 'text_chunk', text: ev.text }));

            // Clause-level TTS splitting for reduced latency.
            const splitType = TTSService.shouldSplitForTTS(sentenceBuffer);
            if (splitType) {
              const split = TTSService.splitAtBreak(sentenceBuffer, splitType);
              if (split && split.toSpeak.length > 5) {
                sentenceBuffer = split.remaining;
                speak(split.toSpeak);
              }
            }
          } else if (ev.type === 'tool_start') {
            // Flush any pending speech so audio doesn't stall across the tool call.
            if (sentenceBuffer.trim().length > 3) { speak(sentenceBuffer); sentenceBuffer = ''; }
            ws.send(JSON.stringify({ type: 'tool', name: ev.name, status: 'start' }));
          } else if (ev.type === 'tool_result') {
            ws.send(JSON.stringify({ type: 'tool', name: ev.name, status: 'done' }));
          }
        }

        // Speak the trailing buffer (unless we've already been interrupted).
        if (!myController.signal.aborted && sentenceBuffer.trim().length > 3) speak(sentenceBuffer);

        // Wait for queued audio so the URLs land before response_complete — but
        // bail the instant an interrupt fires, so the lock releases fast and a
        // quick follow-up turn isn't dropped. Orphaned synth .then()s are
        // abort-guarded and won't send.
        if (!myController.signal.aborted) {
          await Promise.race([
            Promise.allSettled(ttsPromises),
            new Promise((res) => myController.signal.addEventListener('abort', () => res(null), { once: true })),
          ]);
        }

        // Interrupted at any point → the interrupt handler already saved the
        // partial and sent 'interrupted'. Don't double-save or send a late
        // response_complete.
        if (myController.signal.aborted) return;

        ws.send(JSON.stringify({ type: 'response_complete' }));
        console.log(`🤖 Jarvis: ${fullResponse.slice(0, 100)}...`);
        currentPartialResponse = '';

        // ─── Save & extract (skip when off the record) ───
        if (fullResponse.trim() && !privacy.isOffTheRecord(sessionId)) {
          memory.saveMessage(sessionId, 'assistant', fullResponse);

          // Async background tasks (non-blocking)
          memory.extractMemoriesFromExchange(llm, userText, fullResponse).catch(e => console.error('❌ Memory extraction error:', e.message));
          memory.updateUserModel(llm, userText, fullResponse).catch(e => console.error('❌ Profile update error:', e.message));
          mood.analyzeMood(llm, sessionId, userText).catch(e => console.error('❌ Mood analysis error:', e.message));
          memory.extractRelationships(llm, userText, fullResponse).catch(e => console.error('❌ Relationship extraction error:', e.message));
          memory.extractTasks(llm, userText, fullResponse).catch(e => console.error('❌ Task extraction error:', e.message));
          memory.extractPreferences(llm, userText, fullResponse).catch(e => console.error('❌ Preference extraction error:', e.message));
          memory.extractEntities(llm, userText, fullResponse).catch(e => console.error('❌ Entity extraction error:', e.message));
          followUp.detectFollowUpOpportunity(llm, userText, fullResponse).catch(e => console.error('❌ Follow-up detection error:', e.message));
        }

      } catch (error) {
        if (myController.signal.aborted) {
          // Aborted mid-stream — already handled by the interrupt path.
        } else {
          console.error('❌ Error:', error.message);
          ws.send(JSON.stringify({
            type: 'error',
            message: (error.message || '').match(/api_?key|authentication|API key/i)
              ? `Invalid ${llm.displayName} API key. Check your configuration.`
              : 'Something went wrong. Try again.',
          }));
        }
      } finally {
        // Only the owning request clears shared state — a turn that started after
        // an interrupt must not be reset by the aborted turn's finally (#2, #3).
        if (abortController === myController) {
          isProcessing = false;
          abortController = null;
        }
      }
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    // Don't leak off-the-record state across reconnects on the same Set (#27).
    privacy.goOnTheRecord(sessionId);
    console.log(`🔴 Client disconnected [${sessionId.slice(0, 8)}]`);
    // Summarize session on disconnect (if enough messages)
    memory.summarizeSession(llm, sessionId).catch(e => {
      console.error('❌ Session summarization error:', e.message);
    });
  });
});

// ─── Periodic Tasks ──────────────────────────────────────
setInterval(() => tts.cleanup(), 300000);              // Clean audio every 5 min
setInterval(() => memory.cleanupDecayedMemories(), 3600000); // Clean decayed memories every hour
setInterval(() => auth.cleanup(), 600000);             // Clean expired auth sessions every 10 min
setInterval(() => memory.detectRoutines(), 21600000);  // Detect routines every 6 hours

// ─── Start proactive services ────────────────────────────
briefing.start();
followUp.start();
backup.start();

// ─── Initialize embeddings in background ─────────────────
memory.initEmbeddings().catch(e => {
  console.error('⚠️ Embedding init failed (semantic search will use keyword fallback):', e.message);
});

// ─── Start ───────────────────────────────────────────────
server.listen(PORT, () => {
  const features = [
    'Agentic Tool-Calling (Feature 1)',
    'Voice RAG over Documents (Feature 2)',
    'Proactive Intelligence (Feature 3)',
    'Semantic Memory + Decay',
    'Continuous Extraction',
    'Deep User Profile',
    'Reminder System',
    'Push Notifications (PWA)',
    'Temporal Awareness',
    'Mood Detection',
    search.braveKey ? 'Web Search ✅' : 'Web Search (no API key)',
    search.weatherKey ? 'Weather ✅' : 'Weather (no API key)',
    'Reduced Latency TTS',
    'Encrypted Storage',
    calendar.ready ? 'Google Calendar ✅' : 'Google Calendar (not linked)',
    phone.ready ? 'Phone Calls (Twilio) ✅' : 'Phone Calls (no Twilio)',
    'Speaker Identification',
    auth.pinSet ? 'PIN Auth ✅' : 'PIN Auth (not set)',
    'Relationship Tracking',
    'Session Summaries',
    'Task Tracking',
    'Preference Learning',
    'Routine Detection',
    'Notes System',
    'Follow-Up Tracking',
    briefing.enabled ? 'Morning Briefing ✅' : 'Morning Briefing (disabled)',
    email.ready ? 'Gmail ✅' : 'Gmail (not linked)',
    smarthome.ready ? 'Smart Home ✅' : 'Smart Home (not configured)',
    music.ready ? 'Spotify ✅' : 'Spotify (not configured)',
    'Privacy Controls',
    'Automated Backups',
    'System Monitoring',
    'Emotional TTS',
  ];

  console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║       🤖  J.A.R.V.I.S  is online            ║
║       Powered by ${llm.displayName.padEnd(23)}║
║                                              ║
║       http://localhost:${String(PORT).padEnd(22)}║
║       Voice: ${tts.voice.padEnd(30)}║
║                                              ║
║       Features:                              ║
${features.map(f => `║       ✅ ${f.padEnd(34)}║`).join('\n')}
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  reminders.stop();
  briefing.stop();
  followUp.stop();
  backup.stop();
  memory.close();
  process.exit(0);
});
