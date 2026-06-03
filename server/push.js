// Push notification service — VAPID-based web push
const webpush = require('web-push');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class PushService {
  constructor(memoryService) {
    this.memory = memoryService;
    this.ready = false;

    const email = process.env.VAPID_EMAIL || 'mailto:jarvis@example.com';
    let publicKey = process.env.VAPID_PUBLIC_KEY;
    let privateKey = process.env.VAPID_PRIVATE_KEY;

    // If env keys are absent, load a persisted keypair (or generate + persist one)
    // so subscriptions are not invalidated on every restart/redeploy.
    if (!publicKey || !privateKey) {
      const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
      const VAPID_FILE = path.join(DATA_DIR, '.jarvis_vapid.json');
      try {
        if (fs.existsSync(VAPID_FILE)) {
          const saved = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
          publicKey = saved.publicKey;
          privateKey = saved.privateKey;
        } else {
          const keys = webpush.generateVAPIDKeys();
          publicKey = keys.publicKey;
          privateKey = keys.privateKey;
          fs.writeFileSync(VAPID_FILE, JSON.stringify(keys), { mode: 0o600 });
          console.log('🔔 Generated and persisted VAPID keys (.jarvis_vapid.json)');
        }
      } catch (e) {
        // Last resort: ephemeral keys (push works this session only)
        const keys = webpush.generateVAPIDKeys();
        publicKey = keys.publicKey;
        privateKey = keys.privateKey;
        console.warn('🔔 Using ephemeral VAPID keys (could not persist):', e.message);
      }
    }

    webpush.setVapidDetails(email, publicKey, privateKey);
    this.vapidPublicKey = publicKey;
    this.ready = true;
    console.log('🔔 Push notification service ready');
  }

  // Save a push subscription
  subscribe(subscription) {
    this.memory.savePushSubscription(
      subscription.endpoint,
      JSON.stringify(subscription.keys)
    );
  }

  // Remove a push subscription
  unsubscribe(endpoint) {
    this.memory.removePushSubscription(endpoint);
  }

  // Send push notification to all subscribed devices
  async sendToAll(payload) {
    if (!this.ready) return;

    const subscriptions = this.memory.getAllPushSubscriptions();
    const data = JSON.stringify(payload);

    const results = await Promise.allSettled(
      subscriptions.map(sub => {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: JSON.parse(sub.keys_json),
        };
        return webpush.sendNotification(pushSub, data).catch(err => {
          // Remove invalid/stale subscriptions: 410 Gone, 404 Not Found,
          // 403 VapidPkHashMismatch (keypair changed → client must re-subscribe).
          if ([410, 404, 403].includes(err.statusCode)) {
            this.memory.removePushSubscription(sub.endpoint);
          }
          throw err;
        });
      })
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    if (sent > 0) {
      console.log(`🔔 Push notification sent to ${sent}/${subscriptions.length} devices`);
    }
  }

  // Send a reminder notification
  async sendReminder(reminder) {
    await this.sendToAll({
      title: 'J.A.R.V.I.S — Reminder',
      body: reminder.content,
      tag: `reminder-${reminder.id}`,
      reminderId: reminder.id,
      url: '/',
    });
  }
}

module.exports = PushService;
