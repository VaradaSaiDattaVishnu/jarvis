// Sentiment & Mood Detection Service
// Tracks user mood over time and provides adaptive tone context

class MoodService {
  constructor(memoryDb) {
    this.db = memoryDb;
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mood_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        mood TEXT NOT NULL,
        intensity REAL DEFAULT 0.5,
        triggers TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mood_timestamp ON mood_log(timestamp);
    `);

    this._insertMood = this.db.prepare(
      'INSERT INTO mood_log (session_id, mood, intensity, triggers) VALUES (?, ?, ?, ?)'
    );
  }

  // Log a detected mood
  logMood(sessionId, mood, intensity, triggers = '') {
    this._insertMood.run(sessionId, mood, intensity, triggers);
  }

  // Get the most recent mood
  getCurrentMood() {
    return this.db.prepare(
      'SELECT mood, intensity, triggers, timestamp FROM mood_log ORDER BY timestamp DESC LIMIT 1'
    ).get() || null;
  }

  // Get mood trend over recent history
  getMoodTrend(hours = 24) {
    return this.db.prepare(
      `SELECT mood, intensity, timestamp FROM mood_log
       WHERE timestamp > datetime('now', '-${Math.floor(hours)} hours')
       ORDER BY timestamp DESC LIMIT 20`
    ).all();
  }

  // Get a summary string for the system prompt
  getMoodContext() {
    const current = this.getCurrentMood();
    if (!current) return '';

    const trend = this.getMoodTrend(24);
    const moodCounts = {};
    trend.forEach(m => { moodCounts[m.mood] = (moodCounts[m.mood] || 0) + 1; });

    let context = `\n\n[USER MOOD]\n- Current: ${current.mood} (intensity: ${current.intensity})`;
    if (current.triggers) {
      context += ` — related to: ${current.triggers}`;
    }

    // Dominant mood today
    if (trend.length > 2) {
      const dominant = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
      context += `\n- Today's dominant mood: ${dominant[0]}`;
    }

    // Mood-specific instruction
    const instructions = {
      stressed: 'Be calmer, more supportive. Acknowledge the stress before offering solutions.',
      anxious: 'Be gentle and reassuring. Help ground them.',
      sad: 'Be empathetic and warm. Validate their feelings before problem-solving.',
      frustrated: 'Acknowledge the frustration. Be patient and solution-oriented.',
      excited: 'Match their energy! Be enthusiastic.',
      happy: 'Be upbeat and positive. Share in their good mood.',
      neutral: '',
      tired: 'Be concise and gentle. Don\'t overwhelm with information.',
    };
    const instruction = instructions[current.mood] || '';
    if (instruction) {
      context += `\n- Tone guidance: ${instruction}`;
    }

    return context;
  }

  // Analyze mood from an LLM (called async after each exchange)
  async analyzeMood(llmService, sessionId, userMsg) {
    try {
      const result = await llmService.chat(
        `You are a mood detection system. Analyze the user's message for emotional tone.

Return ONLY a JSON object:
{
  "mood": one of "happy", "sad", "stressed", "anxious", "frustrated", "excited", "neutral", "tired", "angry", "curious",
  "intensity": 0.0 to 1.0 (0=barely, 1=extremely),
  "triggers": brief note on what caused this mood (or "" if unclear)
}

If the message is purely informational with no emotional signal, return: {"mood":"neutral","intensity":0.3,"triggers":""}`,
        [{ role: 'user', content: userMsg }]
      );

      const cleaned = result.replace(/```json?|```/g, '').trim();
      const mood = JSON.parse(cleaned);

      if (mood && mood.mood) {
        this.logMood(sessionId, mood.mood, mood.intensity || 0.5, mood.triggers || '');
        if (mood.mood !== 'neutral') {
          console.log(`😊 Mood detected: ${mood.mood} (${mood.intensity})`);
        }
      }
    } catch (e) {
      // Silently skip on parse failures
      if (!(e instanceof SyntaxError)) {
        console.error('Mood analysis failed:', e.message);
      }
    }
  }
}

module.exports = MoodService;
