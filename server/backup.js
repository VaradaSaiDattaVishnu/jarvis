// J.A.R.V.I.S — Backup Service
// Automated SQLite backups with retention policy

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// Keep backups on the persistent data volume in production (DATA_DIR), so they
// survive container restarts alongside the DB they protect.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');

class BackupService {
  constructor({ memoryService }) {
    this.memory = memoryService;
    this.backupDir = path.join(DATA_DIR, 'backups');
    this.retentionDays = 30;
    this.cronJob = null;

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  start() {
    // Daily backup at 3 AM
    this.cronJob = cron.schedule('0 3 * * *', () => {
      this.createBackup().catch(e => {
        console.error('❌ Backup failed:', e.message);
      });
    });
    console.log('💾 Backup service active (daily at 3:00 AM)');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  async createBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `jarvis_backup_${timestamp}.db`;
    const backupPath = path.join(this.backupDir, filename);

    try {
      // Use better-sqlite3's backup API for safe, consistent copies
      await this.memory.db.backup(backupPath);
      console.log(`💾 Backup created: ${filename}`);

      // Cleanup old backups
      this._cleanupOldBackups();

      return { success: true, filename, path: backupPath };
    } catch (e) {
      console.error('💾 Backup error:', e.message);
      return { error: e.message };
    }
  }

  _cleanupOldBackups() {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    try {
      const files = fs.readdirSync(this.backupDir);
      let cleaned = 0;
      for (const f of files) {
        if (!f.startsWith('jarvis_backup_')) continue;
        const fp = path.join(this.backupDir, f);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`💾 Cleaned ${cleaned} old backup(s)`);
    } catch (e) { /* ignore */ }
  }

  listBackups() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('jarvis_backup_'))
        .map(f => {
          const fp = path.join(this.backupDir, f);
          const stat = fs.statSync(fp);
          return {
            filename: f,
            size: stat.size,
            created: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.created) - new Date(a.created));
      return files;
    } catch (e) {
      return [];
    }
  }

  exportJSON() {
    const profile = this.memory.getProfile();
    const memories = this.memory.db.prepare('SELECT category, content, keywords, importance, created_at FROM memories').all();
    const reminders = this.memory.db.prepare('SELECT content, trigger_time, recurrence, status FROM reminders').all();
    const relationships = this.memory.getRelationships();
    const tasks = this.memory.db.prepare('SELECT * FROM tasks').all();
    const preferences = this.memory.getPreferences();
    const notes = this.memory.getAllNotes();
    const summaries = this.memory.getRecentSummaries(50);

    return {
      exportDate: new Date().toISOString(),
      version: '1.0',
      data: { profile, memories, reminders, relationships, tasks, preferences, notes, summaries },
    };
  }

  setupRoutes(app) {
    app.post('/api/backup/create', async (req, res) => {
      const result = await this.createBackup();
      res.json(result);
    });

    app.get('/api/backup/list', (req, res) => {
      res.json({ backups: this.listBackups() });
    });

    app.get('/api/backup/export', (req, res) => {
      const data = this.exportJSON();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="jarvis-export-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(data);
    });
  }
}

module.exports = BackupService;
