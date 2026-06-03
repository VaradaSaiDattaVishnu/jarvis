// J.A.R.V.I.S — Email Service (Gmail via Google OAuth)
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

class EmailService {
  constructor({ calendarService }) {
    this.calendar = calendarService; // Shares OAuth client
    this.gmail = null;
    this.ready = false;
    this._init();
  }

  _init() {
    if (!this.calendar.ready) {
      console.log('📧 Email not available (Google OAuth not configured)');
      return;
    }

    // Reuse the calendar's (current) OAuth client
    this.gmail = google.gmail({ version: 'v1', auth: this.calendar.oauth2Client });
    this.ready = true;
    console.log('📧 Email service ready (via Google OAuth)');
  }

  // Re-bind to the calendar's OAuth client after a (re)authorization. Calendar
  // replaces its oauth2Client on reloadCredentials, so we must rebind, not cache.
  reinit() {
    this.ready = false;
    this.gmail = null;
    this._init();
  }

  needsEmail(text) {
    const lower = text.toLowerCase();
    const triggers = [
      'email', 'emails', 'mail', 'inbox', 'send email',
      'check email', 'read email', 'draft', 'unread',
      'compose', 'reply', 'send a message to',
    ];
    return triggers.some(t => lower.includes(t));
  }

  async getRecentEmails(maxResults = 10) {
    if (!this.ready) return { error: 'Email not configured' };

    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: 'in:inbox',
      });

      if (!response.data.messages) return [];

      const emails = [];
      for (const msg of response.data.messages.slice(0, maxResults)) {
        const full = await this.gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = full.data.payload.headers;
        emails.push({
          id: msg.id,
          from: headers.find(h => h.name === 'From')?.value || 'Unknown',
          subject: headers.find(h => h.name === 'Subject')?.value || '(no subject)',
          date: headers.find(h => h.name === 'Date')?.value || '',
          snippet: full.data.snippet,
          unread: full.data.labelIds?.includes('UNREAD') || false,
        });
      }

      return emails;
    } catch (e) {
      console.error('Email fetch failed:', e.message);
      return { error: e.message };
    }
  }

  async getUnreadCount() {
    if (!this.ready) return 0;
    try {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: 'in:inbox is:unread',
        maxResults: 1,
      });
      return response.data.resultSizeEstimate || 0;
    } catch (e) {
      return 0;
    }
  }

  async sendEmail(to, subject, body) {
    if (!this.ready) return { error: 'Email not configured' };

    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const result = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
      return { success: true, id: result.data.id };
    } catch (e) {
      console.error('Email send failed:', e.message);
      return { error: e.message };
    }
  }

  formatEmailsForContext(emails) {
    if (!emails || emails.error || emails.length === 0) return '';
    return '\n\n[RECENT EMAILS]\n' +
      emails.slice(0, 5).map(e =>
        `- ${e.unread ? '📩' : '📨'} From: ${e.from} — "${e.subject}": ${e.snippet?.slice(0, 80)}...`
      ).join('\n');
  }

  setupRoutes(app) {
    app.get('/api/email/recent', async (req, res) => {
      const max = parseInt(req.query.max) || 10;
      const emails = await this.getRecentEmails(max);
      res.json({ emails });
    });

    app.get('/api/email/unread', async (req, res) => {
      const count = await this.getUnreadCount();
      res.json({ count, unreadCount: count });
    });

    app.post('/api/email/send', async (req, res) => {
      const { to, subject, body } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: 'to, subject, and body required' });
      }
      const result = await this.sendEmail(to, subject, body);
      res.json(result);
    });
  }
}

module.exports = EmailService;
