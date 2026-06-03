// Encryption service — field-level encryption for sensitive data
// Uses AES-256-GCM with a user-derived key

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-gcm';
// Persist the key alongside the DB (DATA_DIR volume in prod) so encrypted
// fields remain decryptable across redeploys. Prefer JARVIS_ENCRYPTION_KEY env.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const KEY_FILE = path.join(DATA_DIR, '.jarvis_key');

class EncryptionService {
  constructor() {
    this.key = null;
    this.enabled = false;
    this._init();
  }

  _init() {
    // Load or generate encryption key
    const envKey = process.env.JARVIS_ENCRYPTION_KEY;
    if (envKey) {
      // Use env-provided key (must be 64 hex chars = 32 bytes)
      this.key = Buffer.from(envKey, 'hex');
      this.enabled = true;
    } else if (fs.existsSync(KEY_FILE)) {
      // Load from key file
      this.key = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
      this.enabled = true;
    } else {
      // Auto-generate and save
      this.key = crypto.randomBytes(32);
      try {
        fs.writeFileSync(KEY_FILE, this.key.toString('hex'), { mode: 0o600 });
        this.enabled = true;
        console.log('🔒 Generated new encryption key (saved to .jarvis_key)');
      } catch (e) {
        console.error('⚠️ Could not save encryption key:', e.message);
        this.enabled = false;
      }
    }

    if (this.enabled) {
      console.log('🔒 Encryption service active');
    }
  }

  // Encrypt a string → returns "iv:authTag:ciphertext" (all hex)
  encrypt(plaintext) {
    if (!this.enabled) return plaintext;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  // Decrypt "iv:authTag:ciphertext" → returns plaintext
  decrypt(ciphertext) {
    if (!this.enabled) return ciphertext;

    // If it doesn't look encrypted (no colons), return as-is (legacy unencrypted data)
    if (!ciphertext.includes(':')) return ciphertext;

    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) return ciphertext; // Not encrypted format

      const [ivHex, authTagHex, encryptedHex] = parts;
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      // Decryption failed — likely unencrypted legacy data
      return ciphertext;
    }
  }

  // Check if a string looks like it's already encrypted
  isEncrypted(text) {
    if (!text || typeof text !== 'string') return false;
    const parts = text.split(':');
    return parts.length === 3 && /^[0-9a-f]{24}$/.test(parts[0]);
  }
}

module.exports = EncryptionService;
