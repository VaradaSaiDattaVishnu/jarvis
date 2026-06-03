// J.A.R.V.I.S — Follow-Up & Smart Nudge Service

const { formatDateTime } = require('./timeparser');

class FollowUpService {
  constructor({ memoryService, llmService, pushService, connectedClients }) {
    this.memory = memoryService;
    this.llm = llmService;
    this.push = pushService;
    this.connectedClients = connectedClients;
    this.checkInterval = null;
    this.nudgeInterval = null;
    this.lastInteraction = Date.now();
    this.offTheRecord = false;
    // id -> timestamp first delivered to a live client (awaiting its ack). Prevents
    // re-broadcasting the same follow-up every sweep, and after a grace window we
    // fall back to push + mark-done so an un-acked follow-up can't loop forever (#8).
    this.deliveredAt = new Map();
    this.ACK_GRACE_MS = 6 * 60 * 60 * 1000; // 6h

    // Configurable
    this.nudgeAfterHours = parseInt(process.env.NUDGE_AFTER_HOURS) || 24;
    this.quietStart = parseInt(process.env.NUDGE_QUIET_START) || 22; // 10 PM
    this.quietEnd = parseInt(process.env.NUDGE_QUIET_END) || 8;     // 8 AM
  }

  start() {
    // Check for due follow-ups every 30 minutes
    this.checkInterval = setInterval(() => {
      this.checkDueFollowUps().catch(e => {
        console.error('❌ Follow-up check error:', e.message);
      });
    }, 1800000);

    // Check for nudge opportunity every hour
    this.nudgeInterval = setInterval(() => {
      this.checkNudge().catch(e => {
        console.error('❌ Nudge check error:', e.message);
      });
    }, 3600000);

    console.log(`🔔 Follow-up service active (nudge after ${this.nudgeAfterHours}h, quiet ${this.quietStart}:00-${this.quietEnd}:00)`);
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.nudgeInterval) clearInterval(this.nudgeInterval);
  }

  recordInteraction() {
    this.lastInteraction = Date.now();
  }

  isQuietHours() {
    const hour = new Date().getHours();
    if (this.quietStart > this.quietEnd) {
      // Wraps midnight (e.g., 22:00 - 08:00)
      return hour >= this.quietStart || hour < this.quietEnd;
    }
    return hour >= this.quietStart && hour < this.quietEnd;
  }

  async detectFollowUpOpportunity(llmService, userMsg, assistantMsg) {
    if (this.offTheRecord) return 0;

    const exchange = `user: ${userMsg}\nassistant: ${assistantMsg}`;
    try {
      const result = await llmService.chat(
        `Detect if this exchange contains something worth following up on later.
Follow-up triggers: upcoming events, pending decisions, health concerns, job interviews, important meetings, waiting for results, emotional situations.
Return ONLY a JSON array. Each: {"topic": "what to follow up on", "context": "brief context", "check_after_hours": 24-168}
If nothing worth following up, return [].`,
        [{ role: 'user', content: exchange }],
        { useMainModel: true }
      );
      const cleaned = result.replace(/```json?|```/g, '').trim();
      const followUps = JSON.parse(cleaned);
      if (!Array.isArray(followUps)) return 0;

      let count = 0;
      for (const f of followUps) {
        if (!f.topic) continue;
        const hoursLater = f.check_after_hours || 24;
        // Store in local-time format so getDueFollowUps() (compares against
        // datetime('now','localtime')) fires at the right wall-clock moment (#11).
        const checkAfter = formatDateTime(new Date(Date.now() + hoursLater * 3600000));
        this.memory.createFollowUp(f.topic, f.context || '', checkAfter);
        count++;
      }
      if (count > 0) console.log(`🔔 Created ${count} follow-up(s)`);
      return count;
    } catch (e) {
      if (!(e instanceof SyntaxError)) console.error('Follow-up detection failed:', e.message);
      return 0;
    }
  }

  async checkDueFollowUps() {
    if (this.isQuietHours()) return;

    const dueFollowUps = this.memory.getDueFollowUps();
    if (dueFollowUps.length === 0) return;

    const pushAndDone = async (followUp) => {
      await this.push.sendToAll({
        title: 'J.A.R.V.I.S Follow-Up',
        body: `Hey, wanted to check in: ${followUp.topic}`,
        tag: `jarvis-followup-${followUp.id}`,
        url: '/',
      });
      this.memory.markFollowUpDone(followUp.id);
      this.deliveredAt.delete(followUp.id);
    };

    for (const followUp of dueFollowUps) {
      const firstSeen = this.deliveredAt.get(followUp.id);

      if (firstSeen) {
        // Already delivered to a live client on an earlier sweep — we're waiting
        // for its POST /api/followups/:id/done ack (which removes it from 'due').
        // Don't re-broadcast (avoid toast spam). If the ack never lands within the
        // grace window, fall back to push and mark done so it stops looping (#8).
        if (Date.now() - firstSeen > this.ACK_GRACE_MS) {
          await pushAndDone(followUp);
          console.log(`🔔 Follow-up un-acked past grace → pushed: "${followUp.topic}"`);
        }
        continue;
      }

      // First time this follow-up is due.
      let delivered = false;
      for (const ws of this.connectedClients) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'follow_up',
            topic: followUp.topic,
            context: followUp.context,
            id: followUp.id,
          }));
          delivered = true;
        }
      }

      if (delivered) {
        // Await the client ack; record so we don't re-send next sweep (#12, #8).
        this.deliveredAt.set(followUp.id, Date.now());
        console.log(`🔔 Follow-up sent to client (awaiting ack): "${followUp.topic}"`);
      } else {
        // No live client — push (fire-and-forget) and mark done immediately (#12).
        await pushAndDone(followUp);
        console.log(`🔔 Follow-up pushed: "${followUp.topic}"`);
      }
    }
  }

  async checkNudge() {
    if (this.isQuietHours()) return;

    const hoursSinceInteraction = (Date.now() - this.lastInteraction) / 3600000;
    if (hoursSinceInteraction < this.nudgeAfterHours) return;

    // Don't spam — only nudge once per cycle
    this.lastInteraction = Date.now();

    // Build a contextual nudge
    const pendingTasks = this.memory.getTasks('pending');
    const dueFollowUps = this.memory.getDueFollowUps();

    let nudgeBody = "Hey, haven't heard from you in a while. Everything good?";

    if (pendingTasks.length > 0) {
      nudgeBody = `Hey! Just a reminder — you've got ${pendingTasks.length} pending task${pendingTasks.length > 1 ? 's' : ''}. Want to catch up?`;
    } else if (dueFollowUps.length > 0) {
      nudgeBody = `Hey! Wanted to check in about: ${dueFollowUps[0].topic}`;
    }

    await this.push.sendToAll({
      title: 'J.A.R.V.I.S',
      body: nudgeBody,
      tag: 'jarvis-nudge',
      url: '/',
    });

    console.log(`💬 Nudge sent (${hoursSinceInteraction.toFixed(1)}h since last interaction)`);
  }

  setupRoutes(app) {
    app.get('/api/followups', (req, res) => {
      const pending = this.memory.getPendingFollowUps();
      const due = this.memory.getDueFollowUps();
      res.json({ pending, due });
    });

    app.post('/api/followups', (req, res) => {
      const { topic, context, check_after_hours } = req.body;
      if (!topic) return res.status(400).json({ error: 'Topic required' });
      const checkAfter = formatDateTime(new Date(Date.now() + (check_after_hours || 24) * 3600000));
      const id = this.memory.createFollowUp(topic, context || '', checkAfter);
      res.json({ id, success: true });
    });

    app.post('/api/followups/:id/done', (req, res) => {
      this.memory.markFollowUpDone(parseInt(req.params.id));
      res.json({ success: true });
    });

    app.post('/api/followups/config', (req, res) => {
      const { nudge_after_hours, quiet_start, quiet_end } = req.body;
      if (nudge_after_hours) this.nudgeAfterHours = nudge_after_hours;
      if (quiet_start !== undefined) this.quietStart = quiet_start;
      if (quiet_end !== undefined) this.quietEnd = quiet_end;
      res.json({
        nudge_after_hours: this.nudgeAfterHours,
        quiet_start: this.quietStart,
        quiet_end: this.quietEnd,
      });
    });
  }
}

module.exports = FollowUpService;
