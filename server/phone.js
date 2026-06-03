// Twilio Phone Call Integration
// Enables Jarvis to make outbound calls and handle two-way phone conversations

class PhoneService {
  constructor({ ttsService, llmService, memoryService, personality }) {
    this.tts = ttsService;
    this.llm = llmService;
    this.memory = memoryService;
    this.personality = personality;
    this.client = null;
    this.ready = false;
    this._initClient();
  }

  // (Re)build the Twilio client from the current env. Called at boot and again
  // after the setup wizard saves Twilio creds at runtime, so routes (registered
  // unconditionally) start working without a restart (#4).
  _initClient() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    this.userNumber = process.env.USER_PHONE_NUMBER;
    this.baseUrl = process.env.PUBLIC_URL; // e.g., https://your-domain.com

    if (sid && token && this.fromNumber) {
      const twilio = require('twilio');
      this.client = twilio(sid, token);
      this.VoiceResponse = twilio.twiml.VoiceResponse;
      this.ready = true;
      console.log('📞 Twilio phone service ready');
    } else {
      this.client = null;
      this.ready = false;
      console.log('📞 Twilio not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)');
    }
  }

  reload() {
    this._initClient();
    return this.ready;
  }

  // ─── Make an outbound call ──────────────────────────────
  async call(message, toNumber = null) {
    if (!this.ready) {
      return { error: 'Twilio not configured' };
    }

    const to = toNumber || this.userNumber;
    if (!to) {
      return { error: 'No phone number to call. Set USER_PHONE_NUMBER in .env' };
    }

    try {
      const call = await this.client.calls.create({
        to,
        from: this.fromNumber,
        url: `${this.baseUrl}/api/twilio/outbound?message=${encodeURIComponent(message)}`,
        statusCallback: `${this.baseUrl}/api/twilio/status`,
        statusCallbackEvent: ['completed'],
      });

      console.log(`📞 Calling ${to}: "${message}" (SID: ${call.sid})`);
      return { success: true, callSid: call.sid };
    } catch (e) {
      console.error('📞 Call failed:', e.message);
      return { error: e.message };
    }
  }

  // ─── Twilio request signature validation (#10) ─────────
  // Every inbound Twilio webhook is signed with X-Twilio-Signature, an HMAC of
  // the full request URL + POST params keyed by the account auth token. We verify
  // it so nobody can spoof calls/SMS into JARVIS's brain. The signature is computed
  // against the *public* URL Twilio hit, so we rebuild it from PUBLIC_URL rather
  // than req.headers.host (which is the internal address behind a proxy).
  _twilioGuard() {
    const twilio = require('twilio');
    const reject = (res) => res.status(403).type('text/xml').send('<Response><Reject reason="rejected"/></Response>');
    return (req, res, next) => {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken || !this.baseUrl) {
        // Can't verify the signature without BOTH the auth token and the exact
        // public URL. Fail CLOSED — an unverifiable webhook must never reach the
        // LLM/memory. (Set PUBLIC_URL to enable Twilio.) (#5)
        console.warn('🚫 Twilio webhook rejected — set PUBLIC_URL (and TWILIO_AUTH_TOKEN) to enable signature validation.');
        return reject(res);
      }
      const signature = req.header('X-Twilio-Signature') || '';
      const url = this.baseUrl.replace(/\/+$/, '') + req.originalUrl;
      if (!twilio.validateRequest(authToken, signature, url, req.body || {})) {
        console.warn(`🚫 Rejected unsigned/forged Twilio request to ${req.originalUrl}`);
        return reject(res);
      }
      next();
    };
  }

  // ─── Setup Express routes for Twilio webhooks ──────────
  setupRoutes(app) {
    // Routes are mounted UNCONDITIONALLY (so they light up after runtime setup),
    // but 503 until Twilio is actually configured...
    app.use('/api/twilio', (req, res, next) => {
      if (!this.ready) return res.status(503).type('text/xml').send('<Response><Reject reason="rejected"/></Response>');
      next();
    });
    // ...and every webhook is signature-validated (fails closed).
    app.use('/api/twilio', this._twilioGuard());

    // Outbound call handler — speaks the message and gathers response
    app.post('/api/twilio/outbound', (req, res) => {
      const message = req.query.message || 'Hey, this is Jarvis. Just checking in.';
      const twiml = new this.VoiceResponse();

      twiml.say({
        voice: 'Polly.Matthew',
        language: 'en-US',
      }, message);

      // Gather speech response from the user
      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        action: '/api/twilio/respond',
        method: 'POST',
        language: 'en-US',
      });
      gather.say({ voice: 'Polly.Matthew' }, 'Is there anything you\'d like to say back?');

      // If no input, hang up
      twiml.say({ voice: 'Polly.Matthew' }, 'No worries. Talk later!');

      res.type('text/xml');
      res.send(twiml.toString());
    });

    // Handle user's spoken response during a call
    app.post('/api/twilio/respond', async (req, res) => {
      const userSpeech = req.body.SpeechResult;
      const twiml = new this.VoiceResponse();

      if (userSpeech) {
        console.log(`📞 User said on call: "${userSpeech}"`);

        // Generate Jarvis response
        try {
          const profile = this.memory.getFormattedProfile();
          const systemPrompt = this.personality.systemPrompt +
            (profile ? `\n\n[USER PROFILE]\n${profile}` : '') +
            '\n\n[CONTEXT: This is a phone call. Keep responses very brief — 1-2 sentences max. Be warm and natural.]' +
            `\n\nCurrent time: ${new Date().toLocaleString()}`;

          const response = await this.llm.chat(systemPrompt, [
            { role: 'user', content: userSpeech },
          ], { useMainModel: true });

          twiml.say({ voice: 'Polly.Matthew' }, response);

          // Save to memory
          this.memory.saveMessage('phone-call', 'user', userSpeech);
          this.memory.saveMessage('phone-call', 'assistant', response);

          // Allow another round of conversation
          const gather = twiml.gather({
            input: 'speech',
            speechTimeout: 'auto',
            action: '/api/twilio/respond',
            method: 'POST',
            language: 'en-US',
          });
          gather.pause({ length: 1 });

        } catch (e) {
          console.error('📞 Response generation failed:', e.message);
          twiml.say({ voice: 'Polly.Matthew' }, 'Sorry, I had a hiccup. Let\'s continue this later.');
        }
      }

      twiml.say({ voice: 'Polly.Matthew' }, 'Alright, talk to you later!');
      res.type('text/xml');
      res.send(twiml.toString());
    });

    // Call status callback
    app.post('/api/twilio/status', (req, res) => {
      const status = req.body.CallStatus;
      const duration = req.body.CallDuration;
      console.log(`📞 Call ended: ${status} (${duration || 0}s)`);
      res.sendStatus(200);
    });

    // Inbound SMS handler — Jarvis responds via text
    app.post('/api/twilio/sms-inbound', async (req, res) => {
      const from = req.body.From;
      const body = req.body.Body;
      console.log(`💬 SMS from ${from}: "${body}"`);

      try {
        // Save inbound message
        this.memory.saveMessage('sms', 'user', body);

        const profile = this.memory.getFormattedProfile();
        const systemPrompt = this.personality.systemPrompt +
          (profile ? `\n\n[USER PROFILE]\n${profile}` : '') +
          '\n\n[CONTEXT: This is an SMS conversation. Keep responses under 160 characters if possible. Be concise.]' +
          `\n\nCurrent time: ${new Date().toLocaleString()}`;

        const response = await this.llm.chat(systemPrompt, [
          { role: 'user', content: body },
        ], { useMainModel: true });

        this.memory.saveMessage('sms', 'assistant', response);

        // Respond via Twilio MessagingResponse
        const MessagingResponse = require('twilio').twiml.MessagingResponse;
        const msgResp = new MessagingResponse();
        msgResp.message(response);
        res.type('text/xml');
        res.send(msgResp.toString());
      } catch (e) {
        console.error('💬 SMS response failed:', e.message);
        const MessagingResponse = require('twilio').twiml.MessagingResponse;
        const msgResp = new MessagingResponse();
        msgResp.message('Sorry, had a hiccup. Try again in a sec.');
        res.type('text/xml');
        res.send(msgResp.toString());
      }
    });

    // Inbound call handler — Jarvis answers
    app.post('/api/twilio/inbound', (req, res) => {
      const twiml = new this.VoiceResponse();

      twiml.say({
        voice: 'Polly.Matthew',
      }, 'Hey, this is Jarvis. What\'s up?');

      const gather = twiml.gather({
        input: 'speech',
        speechTimeout: 'auto',
        action: '/api/twilio/respond',
        method: 'POST',
        language: 'en-US',
      });
      gather.pause({ length: 1 });

      twiml.say({ voice: 'Polly.Matthew' }, 'Didn\'t catch that. Call me back anytime.');
      res.type('text/xml');
      res.send(twiml.toString());
    });
  }

  // ─── Send an SMS ───────────────────────────────────────
  async sendSMS(message, toNumber = null) {
    if (!this.ready) return { error: 'Twilio not configured' };

    const to = toNumber || this.userNumber;
    if (!to) return { error: 'No phone number' };

    try {
      const msg = await this.client.messages.create({
        body: `[JARVIS] ${message}`,
        from: this.fromNumber,
        to,
      });
      console.log(`💬 SMS sent: "${message}" (SID: ${msg.sid})`);
      return { success: true, sid: msg.sid };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ─── Send WhatsApp message ──────────────────────────────
  async sendWhatsApp(message, toNumber = null) {
    if (!this.ready) return { error: 'Twilio not configured' };

    const to = toNumber || this.userNumber;
    if (!to) return { error: 'No phone number' };

    try {
      const msg = await this.client.messages.create({
        body: message,
        from: `whatsapp:${this.fromNumber}`,
        to: `whatsapp:${to}`,
      });
      console.log(`📱 WhatsApp sent: "${message}" (SID: ${msg.sid})`);
      return { success: true, sid: msg.sid };
    } catch (e) {
      return { error: e.message };
    }
  }

  // ─── Call for reminder delivery ────────────────────────
  async callForReminder(reminder) {
    return this.call(`Hey, just a reminder: ${reminder.content}`);
  }

  // ─── Send proactive message via preferred channel ──────
  async sendProactive(message, channel = 'sms') {
    switch (channel) {
      case 'call': return this.call(message);
      case 'whatsapp': return this.sendWhatsApp(message);
      case 'sms':
      default: return this.sendSMS(message);
    }
  }
}

module.exports = PhoneService;
