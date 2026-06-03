// Natural language time parsing for reminders
// Uses chrono-node for parsing + custom pattern matching for recurrence

const chrono = require('chrono-node');

// Patterns that indicate a reminder intent
const REMINDER_PATTERNS = [
  /remind\s+me\s+(?:to\s+)?(.+)/i,
  /set\s+(?:a\s+)?reminder\s+(?:to\s+|for\s+)?(.+)/i,
  /don'?t\s+let\s+me\s+forget\s+(?:to\s+)?(.+)/i,
  /i\s+need\s+to\s+(?:remember\s+to\s+)?(.+?)(?:\s+at\s+|\s+on\s+|\s+by\s+|\s+tomorrow|\s+next\s+)/i,
];

// Recurrence patterns
const RECURRENCE_PATTERNS = [
  { pattern: /every\s+day/i, recurrence: 'daily' },
  { pattern: /daily/i, recurrence: 'daily' },
  { pattern: /every\s+week/i, recurrence: 'weekly' },
  { pattern: /weekly/i, recurrence: 'weekly' },
  { pattern: /every\s+month/i, recurrence: 'monthly' },
  { pattern: /monthly/i, recurrence: 'monthly' },
  { pattern: /every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i, recurrence: 'weekly' },
  { pattern: /every\s+morning/i, recurrence: 'daily' },
  { pattern: /every\s+evening/i, recurrence: 'daily' },
  { pattern: /every\s+night/i, recurrence: 'daily' },
];

/**
 * Check if a message looks like a reminder request
 */
function isReminderRequest(text) {
  const lower = text.toLowerCase();
  return REMINDER_PATTERNS.some(p => p.test(lower)) ||
    (lower.includes('remind') && (lower.includes(' me ') || lower.includes(' to ')));
}

/**
 * Parse a reminder from natural language text
 * Returns { content, triggerTime, recurrence } or null
 */
function parseReminder(text) {
  // Try to extract the reminder content and time
  const now = new Date();

  // Parse any time reference from the text
  const parsed = chrono.parse(text, now, { forwardDate: true });

  let triggerTime = null;
  let timeText = '';

  if (parsed.length > 0) {
    triggerTime = parsed[0].start.date();
    timeText = parsed[0].text;

    // If the parsed time is in the past, push to tomorrow
    if (triggerTime <= now) {
      triggerTime.setDate(triggerTime.getDate() + 1);
    }
  }

  // Extract recurrence
  let recurrence = null;
  for (const { pattern, recurrence: rec } of RECURRENCE_PATTERNS) {
    if (pattern.test(text)) {
      recurrence = rec;
      break;
    }
  }

  // Extract the actual reminder content (strip time and recurrence phrases)
  let content = text;

  // Try to extract using reminder patterns
  for (const pattern of REMINDER_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      content = match[1];
      break;
    }
  }

  // Remove time-related text from content
  if (timeText) {
    content = content.replace(timeText, '').trim();
  }

  // Remove recurrence text from content
  for (const { pattern } of RECURRENCE_PATTERNS) {
    content = content.replace(pattern, '').trim();
  }

  // Clean up common prefixes/suffixes
  content = content
    .replace(/^(to|that|about)\s+/i, '')
    .replace(/\s+(at|on|by|in|tomorrow|next|every)$/i, '')
    .replace(/\bevery\s+(day|week|month|morning|evening|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, '')
    .replace(/^\s*[,.\-]+\s*/, '')
    .replace(/\s*[,.\-]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!content) return null;

  // Default to 1 hour from now if no time specified
  if (!triggerTime) {
    triggerTime = new Date(now.getTime() + 60 * 60 * 1000);
  }

  return {
    content,
    triggerTime,
    recurrence,
  };
}

/**
 * Format a Date as a SQLite-friendly datetime string (local time)
 */
function formatDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Format a trigger time as a friendly human string
 */
function formatFriendlyTime(date) {
  const now = new Date();
  const diffMs = date - now;
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);

  if (diffMins < 60) return `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  if (diffHours < 24) return `in about ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;

  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Calculate the next occurrence for a recurring reminder
 */
function getNextOccurrence(triggerTime, recurrence) {
  const next = new Date(triggerTime);

  switch (recurrence) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null;
  }

  return next;
}

module.exports = {
  isReminderRequest,
  parseReminder,
  formatDateTime,
  formatFriendlyTime,
  getNextOccurrence,
};
