// PM2 Ecosystem Configuration for J.A.R.V.I.S
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 restart jarvis
//   pm2 logs jarvis
//   pm2 monit

module.exports = {
  apps: [{
    name: 'jarvis',
    script: 'server/index.js',
    cwd: __dirname,

    // Process management
    instances: 1,             // Single instance (stateful with WebSocket + SQLite)
    autorestart: true,        // Auto-restart on crash
    watch: false,             // Don't watch files in production
    max_memory_restart: '512M',

    // Logging
    error_file: './logs/jarvis-error.log',
    out_file: './logs/jarvis-out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',

    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },

    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 10000,

    // Restart strategy
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    restart_delay: 1000,

    // Health monitoring
    min_uptime: 5000,
  }],
};
