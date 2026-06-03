// Reminder service — checks for due reminders and fires callbacks
const { formatDateTime, getNextOccurrence } = require('./timeparser');

class ReminderService {
  constructor(memoryService) {
    this.memory = memoryService;
    this.checkInterval = null;
    this.onReminder = null; // Callback: (reminder) => {}
  }

  // Start checking for due reminders every 30 seconds
  start(callback) {
    this.onReminder = callback;
    this.checkInterval = setInterval(() => this.checkReminders(), 30000);
    // Also check immediately on start
    this.checkReminders();
    console.log('⏰ Reminder service started (checking every 30s)');
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Check for due reminders and fire callbacks
  checkReminders() {
    const due = this.memory.getDueReminders();

    for (const reminder of due) {
      // Mark as triggered
      this.memory.markReminderTriggered(reminder.id);

      // Handle recurrence — create the NEXT strictly-future occurrence so a
      // long-missed recurring reminder doesn't fire repeatedly to catch up.
      if (reminder.recurrence) {
        let nextTime = getNextOccurrence(new Date(reminder.trigger_time), reminder.recurrence);
        const now = new Date();
        let guard = 0;
        while (nextTime && nextTime <= now && guard++ < 3650) {
          nextTime = getNextOccurrence(nextTime, reminder.recurrence);
        }
        if (nextTime) {
          this.memory.createReminder(
            reminder.content,
            formatDateTime(nextTime),
            reminder.recurrence
          );
        }
      }

      // Fire callback
      if (this.onReminder) {
        this.onReminder(reminder);
      }
    }
  }

  // Create a new reminder
  create(content, triggerTime, recurrence = null) {
    const timeStr = formatDateTime(triggerTime);
    const result = this.memory.createReminder(content, timeStr, recurrence);
    return { id: result.lastInsertRowid, content, triggerTime: timeStr, recurrence };
  }

  // List upcoming reminders
  list(limit = 10) {
    return this.memory.getUpcomingReminders(limit);
  }

  // Cancel a reminder by ID
  cancel(id) {
    this.memory.cancelReminder(id);
  }
}

module.exports = ReminderService;
