// J.A.R.V.I.S — Agent tool registry
//
// Builds the list of callable tools (function-calling schemas) and a single
// `execute(name, input)` dispatcher. Tools are exposed conditionally based on
// which integrations are actually connected, so the model never offers an action
// it cannot perform — and `get_integration_status` lets it answer truthfully when
// the user asks "can you access my calendar?".

const chrono = require('chrono-node');
const { formatFriendlyTime, getNextOccurrence, formatDateTime } = require('./timeparser');

const RECURRENCE = [
  { re: /\b(every day|each day|daily|every morning|every evening|every night)\b/i, value: 'daily' },
  { re: /\b(every week|weekly|each week)\b/i, value: 'weekly' },
  { re: /\b(every month|monthly|each month)\b/i, value: 'monthly' },
];

function parseWhen(when) {
  const now = new Date();
  let date = null;
  if (when) {
    try { date = chrono.parseDate(when, now, { forwardDate: true }); } catch { /* ignore */ }
  }
  if (!date || isNaN(date.getTime())) date = new Date(now.getTime() + 60 * 60 * 1000);
  if (date <= now) date = new Date(now.getTime() + 60 * 1000);
  let recurrence = null;
  for (const r of RECURRENCE) { if (when && r.re.test(when)) { recurrence = r.value; break; } }
  return { date, recurrence };
}

function buildTools(services) {
  const { memory, reminders, calendar, search, news, email, smarthome, music, rag, llm } = services;
  const tools = [];
  const handlers = {};

  const add = (def, handler) => { tools.push(def); handlers[def.name] = handler; };

  // ─── Always available ─────────────────────────────────
  add({
    name: 'get_current_time',
    description: 'Get the current date and time. Use whenever the user asks about the time, date, or day of the week.',
    input_schema: { type: 'object', properties: {} },
  }, async () => {
    return `Current date and time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  });

  add({
    name: 'set_reminder',
    description: 'Set a reminder for the user at a specific time. Only call this when the user explicitly asks to be reminded of something.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remind the user about' },
        when: { type: 'string', description: 'Natural-language time, e.g. "tomorrow at 9am", "in 30 minutes", "every day at 7pm"' },
      },
      required: ['content', 'when'],
    },
  }, async ({ content, when }) => {
    if (!content) return 'Could not set reminder: no content provided.';
    const { date, recurrence } = parseWhen(when);
    const r = reminders.create(content, date, recurrence);
    return `Reminder set: "${content}" ${formatFriendlyTime(date)}${recurrence ? ` (repeats ${recurrence})` : ''}.`;
  });

  add({
    name: 'list_reminders',
    description: "List the user's upcoming reminders.",
    input_schema: { type: 'object', properties: {} },
  }, async () => {
    const list = reminders.list(10);
    if (!list.length) return 'There are no upcoming reminders.';
    return 'Upcoming reminders:\n' + list.map(r => `- "${r.content}" at ${r.trigger_time}${r.recurrence ? ` (${r.recurrence})` : ''}`).join('\n');
  });

  add({
    name: 'create_task',
    description: 'Create a to-do task for the user. Only call this when the user clearly wants to track a task or to-do.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The task description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority' },
        due_date: { type: 'string', description: 'Optional natural-language or ISO due date' },
      },
      required: ['content'],
    },
  }, async ({ content, priority, due_date }) => {
    if (!content) return 'Could not create task: no content.';
    let due = null;
    if (due_date) {
      const d = (() => { try { return chrono.parseDate(due_date, new Date(), { forwardDate: true }); } catch { return null; } })();
      if (d && !isNaN(d.getTime())) due = formatDateTime(d);
    }
    const id = memory.createTask(content, priority || 'medium', due);
    return `Created task #${id}: "${content}"${priority === 'high' ? ' (high priority)' : ''}${due ? ` due ${due}` : ''}.`;
  });

  add({
    name: 'list_tasks',
    description: "List the user's tasks. Use this when the user asks what they need to do or about their tasks.",
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'completed'], description: 'Filter by status (default: active tasks)' } },
    },
  }, async ({ status }) => {
    const tasks = memory.getTasks(status === 'completed' ? 'completed' : null);
    if (!tasks.length) return 'No tasks found.';
    return 'Tasks:\n' + tasks.slice(0, 15).map(t => `- #${t.id} [${t.status}] ${t.content}${t.priority === 'high' ? ' (HIGH)' : ''}${t.due_date ? ` — due ${t.due_date}` : ''}`).join('\n');
  });

  add({
    name: 'complete_task',
    description: 'Mark a task as completed by its id. Get the id from list_tasks first if unknown.',
    input_schema: { type: 'object', properties: { id: { type: 'number', description: 'Task id' } }, required: ['id'] },
  }, async ({ id }) => {
    const task = memory.getTask(id);
    if (!task) return `No task with id ${id}.`;
    memory.completeTask(id);
    return `Marked task #${id} ("${task.content}") as completed.`;
  });

  add({
    name: 'search_memory',
    description: "Search your long-term memory of past conversations and facts about the user. Use when the user asks what you remember or references something from the past.",
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }, async ({ query }) => {
    const mems = await memory.searchMemories(query, 6);
    if (!mems.length) return 'No relevant memories found.';
    return 'Relevant memories:\n' + mems.map(m => `- ${m.content}`).join('\n');
  });

  add({
    name: 'save_note',
    description: 'Save a note for the user (voice-first note taking). Use when the user says to take/save/write down a note.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The note body' },
        title: { type: 'string', description: 'Optional short title' },
        tags: { type: 'string', description: 'Optional comma-separated tags' },
      },
      required: ['content'],
    },
  }, async ({ content, title, tags }) => {
    if (!content) return 'Could not save note: empty content.';
    const id = await memory.saveNote(title || null, content, tags || '');
    return `Saved note${title ? ` "${title}"` : ''} (id ${id}).`;
  });

  add({
    name: 'search_notes',
    description: "Search the user's saved notes.",
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }, async ({ query }) => {
    const notes = await memory.searchNotes(query, 5);
    if (!notes.length) return 'No matching notes found.';
    return 'Notes:\n' + notes.map(n => `- ${n.title ? n.title + ': ' : ''}${n.content.slice(0, 160)}`).join('\n');
  });

  add({
    name: 'search_documents',
    description: "Search the user's uploaded documents (their personal knowledge base) and return the most relevant passages with their source titles. Use this whenever the user asks a question that might be answered by a document they uploaded. Always cite the source title in your answer.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What to look for in the documents' } }, required: ['query'] },
  }, async ({ query }) => {
    const results = await rag.search(query, 5);
    if (!results.length) {
      const stats = rag.getStats();
      if (stats.documents === 0) return 'The user has not uploaded any documents yet. Suggest they add documents in the Documents tab.';
      return 'No matching passages found. If the user wants an overview or summary of a whole document, call read_document instead.';
    }
    return rag.formatForContext(results);
  });

  add({
    name: 'list_documents',
    description: "List the titles and ids of the user's uploaded documents (their knowledge base). Use this to see what's available, or before summarizing/reading one so you know its id or exact title.",
    input_schema: { type: 'object', properties: {} },
  }, async () => {
    const docs = rag.listDocuments();
    if (!docs.length) return 'The user has not uploaded any documents yet. Suggest they add one in the Documents tab.';
    return 'Uploaded documents:\n' + docs.map(d => `- #${d.id} "${d.title}" (${d.chunk_count} chunks, ${(d.char_count / 1000).toFixed(1)}k chars)`).join('\n');
  });

  add({
    name: 'read_document',
    description: "Read the FULL text of one uploaded document, by id or title. Use this whenever the user asks you to summarize, review, or describe a WHOLE document — search_documents only returns short matching snippets and cannot summarize a full file. If you don't know which document they mean, call list_documents first.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Document id (preferred; from list_documents)' },
        title: { type: 'string', description: 'Document title or part of it, if the id is unknown' },
      },
    },
  }, async ({ id, title }) => {
    const doc = rag.getDocument(id != null ? id : (title || ''));
    if (!doc) {
      const docs = rag.listDocuments();
      if (!docs.length) return 'The user has not uploaded any documents yet.';
      return `Couldn't find that document. Available: ${docs.map(d => `#${d.id} "${d.title}"`).join(', ')}.`;
    }
    const MAX = 12000; // keep within the prompt budget; summarize the head of very long docs
    const body = doc.content.length > MAX ? doc.content.slice(0, MAX) + '\n…[truncated]' : doc.content;
    return `Document "${doc.title}" (#${doc.id}):\n\n${body}`;
  });

  add({
    name: 'get_integration_status',
    description: 'Report which integrations are currently connected and which tools are available. Use this when the user asks what you can do, or whether you can access a specific service (calendar, email, music, smart home, web, weather).',
    input_schema: { type: 'object', properties: {} },
  }, async () => {
    const lines = [
      `LLM brain: ${llm.displayName} (connected)`,
      `Google Calendar: ${calendar.ready ? 'connected' : 'not connected'}`,
      `Gmail: ${email.ready ? 'connected' : 'not connected'}`,
      `Web search: ${search.braveKey ? 'available' : 'not configured'}`,
      `Weather: ${search.weatherKey ? 'available' : 'not configured'}`,
      `Smart home: ${smarthome.ready ? 'connected' : 'not configured'}`,
      `Spotify: ${music.ready ? (music.authenticated ? 'connected' : 'configured (needs sign-in)') : 'not configured'}`,
      `Documents indexed: ${rag.getStats().documents}`,
    ];
    return 'Integration status:\n' + lines.join('\n');
  });

  // ─── Conditional: web search / weather / news ─────────
  if (search.braveKey) {
    add({
      name: 'web_search',
      description: 'Search the web for current, real-time, or factual information the user asks about (news, prices, events, people, how-to, anything you are unsure about). Returns titles, snippets and source URLs to cite.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    }, async ({ query }) => {
      const r = await search.webSearch(query);
      if (r.error) return `Web search error: ${r.error}`;
      if (!r.results || !r.results.length) return `No web results for "${query}".`;
      return 'Web results:\n' + r.results.map((x, i) => `${i + 1}. ${x.title}\n   ${x.description}\n   ${x.url}`).join('\n');
    });

    add({
      name: 'get_news',
      description: 'Get current news headlines, optionally filtered by topic.',
      input_schema: { type: 'object', properties: { topic: { type: 'string', description: 'Optional topic, e.g. "technology"' } } },
    }, async ({ topic }) => {
      const headlines = await news.getTopHeadlines(topic ? `latest ${topic} news` : 'top news today');
      if (headlines.error) return `News error: ${headlines.error}`;
      if (!Array.isArray(headlines) || !headlines.length) return 'No headlines available.';
      return 'Headlines:\n' + headlines.map(h => `- ${h.title} (${h.source})`).join('\n');
    });
  }

  if (search.weatherKey) {
    add({
      name: 'get_weather',
      description: 'Get the current weather for a location (defaults to the user\'s configured location).',
      input_schema: { type: 'object', properties: { location: { type: 'string', description: 'City name, optional' } } },
    }, async ({ location }) => {
      const w = await search.getWeather(location || null);
      if (w.error) return `Weather error: ${w.error}`;
      return `Weather in ${w.location}, ${w.country}: ${w.temp}°C (feels like ${w.feels_like}°C), ${w.description}, humidity ${w.humidity}%, wind ${w.wind_speed} m/s.`;
    });
  }

  // ─── Conditional: calendar ────────────────────────────
  if (calendar.ready) {
    add({
      name: 'get_calendar',
      description: "Get the user's calendar events for today or the next N days.",
      input_schema: { type: 'object', properties: { days: { type: 'number', description: 'Number of days ahead (default 1 = today)' } } },
    }, async ({ days }) => {
      const events = (days && days > 1) ? await calendar.getUpcomingEvents(days) : await calendar.getTodayEvents();
      if (!events.length) return 'No events found in that window.';
      return 'Calendar:\n' + events.map(e => `- ${e.allDay ? 'All day' : new Date(e.start).toLocaleString()}: ${e.summary}${e.location ? ` @ ${e.location}` : ''}`).join('\n');
    });

    add({
      name: 'create_calendar_event',
      description: 'Create a Google Calendar event. Confirm details with the user first if anything is ambiguous.',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Natural-language or ISO start time' },
          end_time: { type: 'string', description: 'Optional end time' },
          location: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['summary', 'start_time'],
      },
    }, async ({ summary, start_time, end_time, location, description }) => {
      const start = (() => { try { return chrono.parseDate(start_time, new Date(), { forwardDate: true }); } catch { return null; } })();
      if (!start || isNaN(start.getTime())) return `Could not understand the start time "${start_time}".`;
      let end = null;
      if (end_time) { const e = (() => { try { return chrono.parseDate(end_time, start, { forwardDate: true }); } catch { return null; } })(); if (e && !isNaN(e.getTime())) end = e.toISOString(); }
      const res = await calendar.createEvent({ summary, startTime: start.toISOString(), endTime: end, location, description });
      if (res.error) return `Could not create event: ${res.error}`;
      return `Created calendar event "${summary}" at ${start.toLocaleString()}.`;
    });
  }

  // ─── Conditional: email ───────────────────────────────
  if (email.ready) {
    add({
      name: 'get_recent_emails',
      description: 'Fetch the most recent emails from the inbox (subjects, senders, snippets).',
      input_schema: { type: 'object', properties: { max: { type: 'number', description: 'How many (default 5)' } } },
    }, async ({ max }) => {
      const emails = await email.getRecentEmails(max || 5);
      if (emails.error) return `Email error: ${emails.error}`;
      if (!emails.length) return 'Inbox is empty.';
      return 'Recent emails:\n' + emails.map(e => `- ${e.unread ? '(unread) ' : ''}From ${e.from}: "${e.subject}" — ${e.snippet?.slice(0, 100)}`).join('\n');
    });

    add({
      name: 'send_email',
      description: 'Send an email on the user\'s behalf. IMPORTANT: always read back the recipient, subject and body and get explicit confirmation from the user before calling this.',
      input_schema: {
        type: 'object',
        properties: {
          to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' },
        },
        required: ['to', 'subject', 'body'],
      },
    }, async ({ to, subject, body }) => {
      const res = await email.sendEmail(to, subject, body);
      if (res.error) return `Could not send email: ${res.error}`;
      return `Email sent to ${to}.`;
    });
  }

  // ─── Conditional: smart home ──────────────────────────
  if (smarthome.ready) {
    add({
      name: 'list_smart_home_devices',
      description: 'List the smart-home devices and their current states.',
      input_schema: { type: 'object', properties: {} },
    }, async () => {
      const devices = await smarthome.getDevices();
      if (devices.error) return `Smart home error: ${devices.error}`;
      if (!devices.length) return 'No devices found.';
      return 'Devices:\n' + devices.map(d => `- ${d.name} (${d.entity_id}): ${d.state}`).join('\n');
    });

    add({
      name: 'control_smart_home',
      description: 'Control a smart-home device: turn it on/off, set a thermostat temperature, or activate a scene.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['turn_on', 'turn_off', 'set_temperature', 'activate_scene'] },
          entity_id: { type: 'string', description: 'The Home Assistant entity id (from list_smart_home_devices)' },
          temperature: { type: 'number', description: 'Required for set_temperature' },
        },
        required: ['action', 'entity_id'],
      },
    }, async ({ action, entity_id, temperature }) => {
      let res;
      if (action === 'turn_on') res = await smarthome.turnOn(entity_id);
      else if (action === 'turn_off') res = await smarthome.turnOff(entity_id);
      else if (action === 'set_temperature') res = await smarthome.setTemperature(entity_id, temperature);
      else if (action === 'activate_scene') res = await smarthome.activateScene(entity_id);
      else return `Unknown action: ${action}`;
      if (res && res.error) return `Could not ${action} ${entity_id}: ${res.error}`;
      return `Done — ${action.replace('_', ' ')} on ${entity_id}.`;
    });
  }

  // ─── Conditional: music ───────────────────────────────
  if (music.ready) {
    add({
      name: 'control_music',
      description: 'Control Spotify playback: play, pause, skip, or search and play a track.',
      input_schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['play', 'pause', 'next', 'previous', 'now_playing', 'search_play'] },
          query: { type: 'string', description: 'Search query for search_play' },
        },
        required: ['action'],
      },
    }, async ({ action, query }) => {
      if (!music.authenticated) return 'Spotify is configured but the user has not signed in yet (do so in Integrations).';
      if (action === 'play') { await music.play(); return 'Resumed playback.'; }
      if (action === 'pause') { await music.pause(); return 'Paused playback.'; }
      if (action === 'next') { await music.next(); return 'Skipped to next track.'; }
      if (action === 'previous') { await music.previous(); return 'Went to previous track.'; }
      if (action === 'now_playing') {
        const np = await music.getNowPlaying();
        if (np.error || !np.item) return 'Nothing is currently playing.';
        return `Now playing: ${np.item.name} by ${np.item.artists?.map(a => a.name).join(', ')}`;
      }
      if (action === 'search_play') {
        if (!query) return 'No search query provided.';
        const r = await music.search(query, 'track', 1);
        const uri = r?.tracks?.items?.[0]?.uri;
        if (!uri) return `Couldn't find "${query}" on Spotify.`;
        await music.play(uri);
        return `Playing "${r.tracks.items[0].name}" by ${r.tracks.items[0].artists?.map(a => a.name).join(', ')}.`;
      }
      return `Unknown action: ${action}`;
    });
  }

  const defByName = {};
  for (const t of tools) defByName[t.name] = t;

  async function execute(name, input) {
    const handler = handlers[name];
    if (!handler) return `Unknown tool: ${name}`;
    const args = input || {};
    // Guard required args so a malformed/empty call (e.g. a recovered Llama
    // text-format call that lost its arguments) gets a correctable error rather
    // than silently misfiring the tool with {}.
    const required = defByName[name]?.input_schema?.required || [];
    const missing = required.filter(k => args[k] === undefined || args[k] === null || args[k] === '');
    if (missing.length) {
      return `Cannot run ${name}: missing required argument(s): ${missing.join(', ')}. Ask the user or provide them, then try again.`;
    }
    return handler(args);
  }

  return { tools, execute, names: tools.map(t => t.name) };
}

module.exports = { buildTools };
