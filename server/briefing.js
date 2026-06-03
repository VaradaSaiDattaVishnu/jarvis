// J.A.R.V.I.S — Morning Briefing & Anticipatory Suggestions Service
const cron = require('node-cron');

class BriefingService {
  constructor({ memoryService, calendarService, searchService, llmService, pushService, personality }) {
    this.memory = memoryService;
    this.calendar = calendarService;
    this.search = searchService;
    this.llm = llmService;
    this.push = pushService;
    this.personality = personality;
    this.cronJob = null;
    this.enabled = process.env.ENABLE_BRIEFING === 'true';
    this.briefingTime = process.env.BRIEFING_TIME || '08:00';
    this.delivery = process.env.BRIEFING_DELIVERY || 'push'; // push, log
  }

  start() {
    if (!this.enabled) {
      console.log('📋 Briefing service disabled (set ENABLE_BRIEFING=true)');
      return;
    }

    const [hour, minute] = this.briefingTime.split(':').map(Number);
    const cronExpr = `${minute} ${hour} * * *`;

    this.cronJob = cron.schedule(cronExpr, () => {
      this.generateAndDeliver().catch(e => {
        console.error('❌ Briefing generation failed:', e.message);
      });
    });

    console.log(`📋 Briefing service active (daily at ${this.briefingTime})`);
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  async generateBriefing() {
    const sections = [];

    // Calendar events
    if (this.calendar.ready) {
      try {
        const events = await this.calendar.getTodayEvents();
        if (events.length > 0) {
          sections.push({
            type: 'calendar',
            data: events.map(e => `${e.start} — ${e.summary}`).join('\n'),
          });
        }
      } catch (e) { /* skip */ }
    }

    // Weather
    if (this.search.weatherKey) {
      try {
        const weather = await this.search.getWeather();
        if (weather && !weather.error) {
          sections.push({
            type: 'weather',
            data: this.search.formatWeather(weather),
          });
        }
      } catch (e) { /* skip */ }
    }

    // Upcoming reminders
    const reminders = this.memory.getUpcomingReminders(5);
    if (reminders.length > 0) {
      sections.push({
        type: 'reminders',
        data: reminders.map(r => `- "${r.content}" at ${r.trigger_time}`).join('\n'),
      });
    }

    // Pending tasks
    const tasks = this.memory.getTasks('pending');
    if (tasks.length > 0) {
      sections.push({
        type: 'tasks',
        data: tasks.slice(0, 5).map(t => `- ${t.content}${t.priority === 'high' ? ' (HIGH)' : ''}`).join('\n'),
      });
    }

    // Due follow-ups
    const followUps = this.memory.getDueFollowUps();
    if (followUps.length > 0) {
      sections.push({
        type: 'follow_ups',
        data: followUps.map(f => `- ${f.topic}`).join('\n'),
      });
    }

    // Recent conversation summaries for continuity
    const summaries = this.memory.getRecentSummaries(2);
    if (summaries.length > 0) {
      sections.push({
        type: 'recent_context',
        data: summaries.map(s => s.summary).join(' '),
      });
    }

    if (sections.length === 0) {
      return { text: "Good morning! No special items on the agenda today. It's a clean slate.", sections: [] };
    }

    // LLM composes a natural briefing
    const sectionText = sections.map(s => `[${s.type.toUpperCase()}]\n${s.data}`).join('\n\n');

    try {
      const briefingText = await this.llm.chat(
        `You are Jarvis composing a morning briefing for the user. Be concise, warm, and natural — like a real assistant greeting them.
Cover the most important items first. Keep it under 150 words. Don't use section headers — weave it into natural speech.`,
        [{ role: 'user', content: `Here's what I have for today:\n\n${sectionText}` }],
        { useMainModel: true }
      );

      return { text: briefingText, sections };
    } catch (e) {
      // Fallback: structured briefing without LLM
      let fallback = 'Good morning! Here\'s your briefing:\n';
      for (const s of sections) {
        fallback += `\n${s.type}: ${s.data}\n`;
      }
      return { text: fallback, sections };
    }
  }

  // ─── Proactive intelligence (Feature 3) ────────────────
  // Reason over the user's live context (tasks, calendar, follow-ups, recent
  // memories) to surface 2-3 anticipatory suggestions — things JARVIS notices
  // the user might want to act on, without being asked. Returns [] gracefully.
  async generateProactiveInsights() {
    const ctx = [];

    const tasks = this.memory.getTasks('pending');
    if (tasks.length) {
      ctx.push('Pending tasks:\n' + tasks.slice(0, 10)
        .map(t => `- ${t.content}${t.priority === 'high' ? ' (HIGH)' : ''}${t.due_date ? ` — due ${t.due_date}` : ''}`).join('\n'));
    }

    if (this.calendar.ready) {
      try {
        const events = await this.calendar.getUpcomingEvents(3);
        if (events.length) {
          ctx.push('Upcoming calendar (next 3 days):\n' + events
            .map(e => `- ${e.allDay ? 'All day' : new Date(e.start).toLocaleString()}: ${e.summary}`).join('\n'));
        }
      } catch { /* skip */ }
    }

    const followUps = this.memory.getPendingFollowUps();
    if (followUps.length) {
      ctx.push('Open follow-ups:\n' + followUps.slice(0, 8).map(f => `- ${f.topic}`).join('\n'));
    }

    const summaries = this.memory.getRecentSummaries(2);
    if (summaries.length) {
      ctx.push('Recent conversation context:\n' + summaries.map(s => s.summary).join(' '));
    }

    if (ctx.length === 0) {
      return { suggestions: [] };
    }

    const now = new Date();
    try {
      const raw = await this.llm.chat(
        `You are JARVIS's proactive engine. Given the user's current context, suggest 2-3 genuinely useful, anticipatory actions or reminders — things a thoughtful assistant would notice. Be specific and grounded ONLY in the context provided; never invent events or tasks.
Return ONLY a JSON array, each item: {"title": "short actionable suggestion", "detail": "one sentence of why/what", "priority": "low|medium|high"}.
If nothing is genuinely worth surfacing, return [].`,
        [{ role: 'user', content: `Current time: ${now.toLocaleString()}\n\n${ctx.join('\n\n')}` }],
        { useMainModel: true }
      );
      const cleaned = raw.replace(/```json?|```/g, '').trim();
      const suggestions = JSON.parse(cleaned);
      if (!Array.isArray(suggestions)) return { suggestions: [] };
      return { suggestions: suggestions.filter(s => s && s.title).slice(0, 3) };
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Proactive insights failed:', e.message);
      return { suggestions: [] };
    }
  }

  async generateAndDeliver() {
    console.log('📋 Generating morning briefing...');
    const briefing = await this.generateBriefing();

    if (this.delivery === 'push') {
      await this.push.sendToAll({
        title: 'Good Morning from J.A.R.V.I.S',
        body: briefing.text.slice(0, 200),
        tag: 'jarvis-briefing',
        url: '/',
      });
      console.log('📋 Briefing delivered via push notification');
    } else {
      console.log(`📋 Briefing:\n${briefing.text}`);
    }

    return briefing;
  }

  setupRoutes(app) {
    // Manually trigger a briefing
    app.post('/api/briefing/trigger', async (req, res) => {
      try {
        const briefing = await this.generateBriefing();
        res.json({ briefing: briefing.text, sections: briefing.sections });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // Get/set briefing config
    app.get('/api/briefing/config', (req, res) => {
      res.json({
        enabled: this.enabled,
        time: this.briefingTime,
        delivery: this.delivery,
      });
    });

    app.post('/api/briefing/config', (req, res) => {
      const { enabled, time, delivery } = req.body;
      if (typeof enabled === 'boolean') this.enabled = enabled;
      if (time) this.briefingTime = time;
      if (delivery) this.delivery = delivery;

      // Restart cron if settings changed
      this.stop();
      if (this.enabled) this.start();

      res.json({
        enabled: this.enabled,
        time: this.briefingTime,
        delivery: this.delivery,
      });
    });
  }
}

module.exports = BriefingService;
