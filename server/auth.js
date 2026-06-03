// Voice Authentication Service
// PIN-based authentication with optional voice verification
// Gates sensitive operations behind auth

const crypto = require('crypto');

class AuthService {
  constructor(db) {
    this.db = db;
    this.sessions = new Map(); // sessionId → { authenticated, speakerId, expiresAt }
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes

    // Create auth table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Check if PIN is set
    const pin = this.db.prepare('SELECT value FROM auth_config WHERE key = ?').get('pin_hash');
    this.pinSet = !!pin;

    if (this.pinSet) {
      console.log('🔐 Auth: PIN protection active');
    } else {
      console.log('🔐 Auth: No PIN set (use /api/auth/setup-pin to enable)');
    }
  }

  // ─── Setup PIN ──────────────────────────────────────────
  setupPin(pin) {
    const p = String(pin == null ? '' : pin);
    if (!/^\d{4,}$/.test(p)) {
      return { error: 'PIN must be at least 4 digits' };
    }

    // Salted scrypt KDF (slow + per-PIN salt) stored as "salt:hash" (hex)
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync(p, salt, 32);
    const stored = `${salt.toString('hex')}:${derived.toString('hex')}`;

    this.db.prepare(`
      INSERT OR REPLACE INTO auth_config (key, value) VALUES ('pin_hash', ?)
    `).run(stored);

    this.pinSet = true;
    console.log('🔐 PIN has been set');
    return { success: true };
  }

  // ─── Verify PIN ─────────────────────────────────────────
  verifyPin(pin) {
    if (!this.pinSet) return true; // No PIN set means open access

    const row = this.db.prepare('SELECT value FROM auth_config WHERE key = ?').get('pin_hash');
    if (!row) return true;
    if (pin == null) return false;

    const p = String(pin);
    const stored = row.value;

    // New format: "saltHex:hashHex" via scrypt + constant-time compare
    if (stored.includes(':')) {
      const [saltHex, hashHex] = stored.split(':');
      try {
        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const derived = crypto.scryptSync(p, salt, expected.length);
        return crypto.timingSafeEqual(derived, expected);
      } catch { return false; }
    }

    // Legacy format: bare sha256 hex — verify, then transparently upgrade
    const legacy = crypto.createHash('sha256').update(p).digest('hex');
    if (legacy === stored) {
      this.setupPin(p); // migrate to scrypt
      return true;
    }
    return false;
  }

  // ─── Authenticate a session ─────────────────────────────
  authenticate(sessionId, pin) {
    if (!this.pinSet) {
      // No PIN set — auto-authenticate
      this.sessions.set(sessionId, {
        authenticated: true,
        expiresAt: Date.now() + this.sessionTimeout,
      });
      return { success: true, message: 'No PIN required' };
    }

    if (!this.verifyPin(pin)) {
      return { success: false, error: 'Invalid PIN' };
    }

    this.sessions.set(sessionId, {
      authenticated: true,
      expiresAt: Date.now() + this.sessionTimeout,
    });

    return { success: true };
  }

  // ─── Check if session is authenticated ──────────────────
  isAuthenticated(sessionId) {
    if (!this.pinSet) return true; // No PIN means open

    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }

    return session.authenticated;
  }

  // ─── Refresh session timeout ────────────────────────────
  touch(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.expiresAt = Date.now() + this.sessionTimeout;
    }
  }

  // ─── Logout ─────────────────────────────────────────────
  logout(sessionId) {
    this.sessions.delete(sessionId);
  }

  // ─── Change PIN ─────────────────────────────────────────
  changePin(oldPin, newPin) {
    if (this.pinSet && !this.verifyPin(oldPin)) {
      return { error: 'Current PIN is incorrect' };
    }
    return this.setupPin(newPin);
  }

  // ─── Remove PIN ─────────────────────────────────────────
  removePin(currentPin) {
    if (this.pinSet && !this.verifyPin(currentPin)) {
      return { error: 'Current PIN is incorrect' };
    }

    this.db.prepare('DELETE FROM auth_config WHERE key = ?').run('pin_hash');
    this.pinSet = false;
    this.sessions.clear();
    return { success: true };
  }

  // ─── Middleware for protected routes ────────────────────
  requireAuth() {
    return (req, res, next) => {
      if (!this.pinSet) return next();

      const sessionId = req.headers['x-session-id'] || req.query.sessionId;
      if (!sessionId || !this.isAuthenticated(sessionId)) {
        return res.status(401).json({ error: 'Authentication required', needsPin: true });
      }

      this.touch(sessionId);
      next();
    };
  }

  // ─── Cleanup expired sessions ──────────────────────────
  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  // ─── Setup API routes ──────────────────────────────────
  setupRoutes(app) {
    // Setup PIN (first time or change)
    app.post('/api/auth/setup-pin', (req, res) => {
      const { pin, oldPin } = req.body;
      if (typeof pin !== 'string' || !pin) return res.status(400).json({ error: 'PIN required' });

      if (this.pinSet) {
        if (!oldPin) return res.status(400).json({ error: 'Current PIN required to change PIN' });
        const result = this.changePin(oldPin, pin);
        return res.json(result.error ? { ...result } : result);
      }

      const result = this.setupPin(pin);
      res.json(result);
    });

    // Authenticate with PIN
    app.post('/api/auth/login', (req, res) => {
      const { pin, sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

      const result = this.authenticate(sessionId, pin);
      res.json(result);
    });

    // Check auth status
    app.get('/api/auth/status', (req, res) => {
      const sessionId = req.headers['x-session-id'] || req.query.sessionId;
      res.json({
        pinSet: this.pinSet,
        authenticated: sessionId ? this.isAuthenticated(sessionId) : false,
      });
    });

    // Logout
    app.post('/api/auth/logout', (req, res) => {
      const { sessionId } = req.body;
      if (sessionId) this.logout(sessionId);
      res.json({ success: true });
    });

    // Remove PIN
    app.post('/api/auth/remove-pin', (req, res) => {
      const { pin } = req.body;
      const result = this.removePin(pin);
      res.json(result);
    });
  }
}

module.exports = AuthService;
