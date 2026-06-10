// Google Calendar Integration
// OAuth2-based sync for reading and creating calendar events

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const TOKEN_PATH = path.join(DATA_DIR, '.google_token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

class CalendarService {
  constructor() {
    this.ready = false;
    this.oauth2Client = null;
    this.calendar = null;
    this.onAuthChange = null; // hook fired when auth state changes (e.g. to reinit Email)

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';

    if (clientId && clientSecret) {
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      // Try to load saved token
      if (fs.existsSync(TOKEN_PATH)) {
        try {
          const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
          this.oauth2Client.setCredentials(token);
          this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
          this.ready = true;
          console.log('📅 Google Calendar connected');
        } catch (e) {
          console.log('📅 Google Calendar token expired — re-authorize at /api/google/auth');
        }
      } else {
        console.log('📅 Google Calendar configured — authorize at /api/google/auth');
      }

      // Persist refreshed tokens (access_token/expiry on every refresh,
      // refresh_token only when Google returns one — never clobber it).
      this.oauth2Client.on('tokens', (tokens) => this._persistTokens(tokens));
    } else {
      console.log('📅 Google Calendar not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)');
    }
  }

  // Derive the OAuth redirect URI that matches the URL the user actually reached
  // the app on. In production GOOGLE_REDIRECT_URI is usually unset, so falling back
  // to localhost broke the flow (redirect_uri_mismatch). Deriving from the request
  // (with trust proxy on) yields the real public callback — the same one the
  // Integrations UI tells the user to register — and still works in local dev.
  _redirectUri(req) {
    if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '') + '/api/google/callback';
    return `${req.protocol}://${req.get('host')}/api/google/callback`;
  }

  // ─── OAuth Routes ──────────────────────────────────────
  setupRoutes(app) {
    // Start OAuth flow
    app.get('/api/google/auth', (req, res) => {
      if (!this.oauth2Client) {
        return res.status(400).json({ error: 'Google Calendar not configured' });
      }
      const url = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        redirect_uri: this._redirectUri(req),
      });
      res.redirect(url);
    });

    // OAuth callback
    app.get('/api/google/callback', async (req, res) => {
      const code = req.query.code;
      if (!code) return res.status(400).send('No code provided');

      try {
        // redirect_uri MUST match the one used to start the flow.
        const { tokens } = await this.oauth2Client.getToken({ code, redirect_uri: this._redirectUri(req) });
        this.oauth2Client.setCredentials(tokens);
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
        this.ready = true;
        console.log('📅 Google Calendar authorized successfully');
        if (typeof this.onAuthChange === 'function') this.onAuthChange();
        res.send(`<html><body style="background:#000408;color:#e2e8f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#22c55e">Google Calendar Connected!</h2>
            <p>This window will close automatically...</p>
          </div>
          <script>setTimeout(()=>window.close(),2000)</script>
        </body></html>`);
      } catch (e) {
        console.error('📅 OAuth error:', e.message);
        res.status(500).send(`<html><body style="background:#000408;color:#e2e8f0;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2 style="color:#ef4444">Authorization Failed</h2>
            <p>${e.message}</p>
            <p style="color:#f59e0b;margin-top:1em">Check your Client ID and Secret in Integrations, then try again.</p>
          </div>
        </body></html>`);
      }
    });

    // Calendar status
    app.get('/api/google/status', (req, res) => {
      res.json({ connected: this.ready });
    });
  }

  // ─── Get today's events ────────────────────────────────
  async getTodayEvents() {
    if (!this.ready) return [];

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

    try {
      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
      });

      return (res.data.items || []).map(e => ({
        id: e.id,
        summary: e.summary || '(No title)',
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        location: e.location || null,
        description: e.description || null,
        allDay: !e.start.dateTime,
      }));
    } catch (e) {
      console.error('📅 Failed to fetch events:', e.message);
      return [];
    }
  }

  // ─── Get upcoming events (next N days) ─────────────────
  async getUpcomingEvents(days = 7) {
    if (!this.ready) return [];

    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    try {
      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: future.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 30,
      });

      return (res.data.items || []).map(e => ({
        id: e.id,
        summary: e.summary || '(No title)',
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        location: e.location || null,
        allDay: !e.start.dateTime,
      }));
    } catch (e) {
      console.error('📅 Failed to fetch upcoming events:', e.message);
      return [];
    }
  }

  // ─── Create an event ───────────────────────────────────
  async createEvent({ summary, startTime, endTime, description, location }) {
    if (!this.ready) return { error: 'Calendar not connected' };

    // Validate the start time up front so a bad/missing value returns an error
    // instead of throwing an unhandled RangeError out of the route handler.
    const start = new Date(startTime);
    if (isNaN(start.getTime())) return { error: 'Invalid or missing startTime' };
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);
    if (isNaN(end.getTime())) return { error: 'Invalid endTime' };

    try {
      const res = await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          description: description || undefined,
          location: location || undefined,
        },
      });

      console.log(`📅 Event created: "${summary}" at ${startTime}`);
      return { success: true, eventId: res.data.id, link: res.data.htmlLink };
    } catch (e) {
      console.error('📅 Failed to create event:', e.message);
      return { error: e.message };
    }
  }

  // ─── Delete an event ───────────────────────────────────
  async deleteEvent(eventId) {
    if (!this.ready) return { error: 'Calendar not connected' };

    try {
      await this.calendar.events.delete({
        calendarId: 'primary',
        eventId,
      });
      return { success: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ─── Format events for system prompt ───────────────────
  formatEventsForContext(events) {
    if (events.length === 0) return '';

    return '\n\n[TODAY\'S CALENDAR]\n' + events.map(e => {
      if (e.allDay) {
        return `- All day: ${e.summary}${e.location ? ` (${e.location})` : ''}`;
      }
      const time = new Date(e.start).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit',
      });
      return `- ${time}: ${e.summary}${e.location ? ` @ ${e.location}` : ''}`;
    }).join('\n');
  }

  // ─── Detect calendar intent ────────────────────────────
  needsCalendar(text) {
    return /\b(schedule|calendar|meeting|appointment|event|what('s| is) (on |happening )?today|free time|busy|book|block)\b/i.test(text);
  }

  // Detect event creation intent
  isCreateEventRequest(text) {
    return /\b(schedule|book|create|add|set up|block)\b.*\b(meeting|call|appointment|event|time|session)\b/i.test(text) ||
      /\bschedule\b.*\b(with|at|on|for)\b/i.test(text);
  }

  // ─── Smart Scheduling: Find free slots ──────────────────
  async getFreeBusy(startDate, endDate) {
    if (!this.ready) return { error: 'Calendar not connected' };

    try {
      const res = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: new Date(startDate).toISOString(),
          timeMax: new Date(endDate).toISOString(),
          items: [{ id: 'primary' }],
        },
      });

      return res.data.calendars.primary.busy || [];
    } catch (e) {
      console.error('📅 FreeBusy query failed:', e.message);
      return { error: e.message };
    }
  }

  async suggestOptimalTime(durationMinutes = 60, preferredHours = { start: 9, end: 17 }, daysAhead = 7) {
    if (!this.ready) return { error: 'Calendar not connected' };

    const now = new Date();
    const endSearch = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const busySlots = await this.getFreeBusy(now, endSearch);
    if (busySlots.error) return busySlots;

    const suggestions = [];
    const durationMs = durationMinutes * 60 * 1000;

    // Iterate day by day
    for (let d = 0; d < daysAhead && suggestions.length < 3; d++) {
      const day = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), preferredHours.start);
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), preferredHours.end);

      if (dayStart < now) dayStart.setTime(Math.max(dayStart.getTime(), now.getTime()));

      // Find gaps
      let cursor = dayStart.getTime();
      const dayBusy = busySlots
        .filter(b => {
          const bStart = new Date(b.start).getTime();
          const bEnd = new Date(b.end).getTime();
          return bEnd > dayStart.getTime() && bStart < dayEnd.getTime();
        })
        .sort((a, b) => new Date(a.start) - new Date(b.start));

      for (const busy of dayBusy) {
        const busyStart = new Date(busy.start).getTime();
        if (busyStart - cursor >= durationMs) {
          suggestions.push({
            start: new Date(cursor).toISOString(),
            end: new Date(cursor + durationMs).toISOString(),
            day: day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
          });
          if (suggestions.length >= 3) break;
        }
        cursor = Math.max(cursor, new Date(busy.end).getTime());
      }

      // Check remaining time after last busy slot
      if (suggestions.length < 3 && dayEnd.getTime() - cursor >= durationMs) {
        suggestions.push({
          start: new Date(cursor).toISOString(),
          end: new Date(cursor + durationMs).toISOString(),
          day: day.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        });
      }
    }

    return suggestions;
  }

  async detectConflicts(startTime, endTime) {
    if (!this.ready) return [];

    try {
      const res = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date(startTime).toISOString(),
        timeMax: new Date(endTime).toISOString(),
        singleEvents: true,
        maxResults: 10,
      });

      return (res.data.items || []).map(e => ({
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
      }));
    } catch (e) {
      return [];
    }
  }

  // ─── Event Context: enrich with memory ──────────────────
  async getEventContext(event, memoryService) {
    if (!memoryService) return null;

    const searchTerms = [event.summary];
    if (event.description) searchTerms.push(event.description);

    try {
      const memories = await memoryService.searchMemories(searchTerms.join(' '), 3);
      if (memories.length === 0) return null;

      return {
        event: event.summary,
        relatedMemories: memories.map(m => m.content),
      };
    } catch (e) {
      return null;
    }
  }

  // ─── Reload OAuth client with new credentials ─────────
  reloadCredentials() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/google/callback';

    if (clientId && clientSecret) {
      this.oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

      // Check for existing token
      if (fs.existsSync(TOKEN_PATH)) {
        try {
          const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
          this.oauth2Client.setCredentials(token);
          this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
          this.ready = true;
          console.log('📅 Google Calendar reconnected with new credentials');
        } catch (e) {
          this.ready = false;
          console.log('📅 Google Calendar credentials updated — authorize at /api/google/auth');
        }
      } else {
        this.ready = false;
        console.log('📅 Google Calendar credentials updated — authorize at /api/google/auth');
      }

      // Refresh token listener
      this.oauth2Client.on('tokens', (tokens) => this._persistTokens(tokens));
    }
    if (typeof this.onAuthChange === 'function') this.onAuthChange();
  }

  // Persist tokens, merging fields so refresh-only events don't drop refresh_token
  _persistTokens(tokens) {
    try {
      const saved = fs.existsSync(TOKEN_PATH)
        ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'))
        : {};
      if (tokens.access_token) saved.access_token = tokens.access_token;
      if (tokens.expiry_date) saved.expiry_date = tokens.expiry_date;
      if (tokens.refresh_token) saved.refresh_token = tokens.refresh_token;
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(saved), { mode: 0o600 });
    } catch (e) {
      console.error('📅 Failed to persist Google token:', e.message);
    }
  }
}

module.exports = CalendarService;
