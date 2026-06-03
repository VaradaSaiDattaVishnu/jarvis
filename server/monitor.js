// J.A.R.V.I.S — Monitor Service
// Track LLM latency, TTS latency, error rates, uptime

class MonitorService {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      llm: { total: 0, errors: 0, latencies: [] },
      tts: { total: 0, errors: 0, latencies: [] },
      websocket: { connections: 0, messages: 0 },
      memory: { extractions: 0, searches: 0 },
    };
    this.maxLatencyWindow = 100; // Keep last 100 measurements
  }

  // Record a metric
  recordLLM(latencyMs, error = false) {
    this.metrics.llm.total++;
    if (error) this.metrics.llm.errors++;
    this.metrics.llm.latencies.push(latencyMs);
    if (this.metrics.llm.latencies.length > this.maxLatencyWindow) {
      this.metrics.llm.latencies.shift();
    }
  }

  recordTTS(latencyMs, error = false) {
    this.metrics.tts.total++;
    if (error) this.metrics.tts.errors++;
    this.metrics.tts.latencies.push(latencyMs);
    if (this.metrics.tts.latencies.length > this.maxLatencyWindow) {
      this.metrics.tts.latencies.shift();
    }
  }

  recordConnection() {
    this.metrics.websocket.connections++;
  }

  recordMessage() {
    this.metrics.websocket.messages++;
  }

  recordExtraction() {
    this.metrics.memory.extractions++;
  }

  recordSearch() {
    this.metrics.memory.searches++;
  }

  _avg(arr) {
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  _p95(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
  }

  getHealth() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = (uptimeMs / 3600000).toFixed(1);

    return {
      status: 'ok',
      uptime: `${uptimeHours}h`,
      uptimeMs,
      llm: {
        totalRequests: this.metrics.llm.total,
        errors: this.metrics.llm.errors,
        errorRate: this.metrics.llm.total > 0
          ? ((this.metrics.llm.errors / this.metrics.llm.total) * 100).toFixed(1) + '%'
          : '0%',
        avgLatencyMs: this._avg(this.metrics.llm.latencies),
        p95LatencyMs: this._p95(this.metrics.llm.latencies),
      },
      tts: {
        totalRequests: this.metrics.tts.total,
        errors: this.metrics.tts.errors,
        avgLatencyMs: this._avg(this.metrics.tts.latencies),
        p95LatencyMs: this._p95(this.metrics.tts.latencies),
      },
      websocket: this.metrics.websocket,
      memory: this.metrics.memory,
      timestamp: new Date().toISOString(),
    };
  }

  setupRoutes(app) {
    app.get('/api/monitor/health', (req, res) => {
      res.json(this.getHealth());
    });

    app.get('/api/monitor/metrics', (req, res) => {
      res.json({
        ...this.getHealth(),
        llmLatencies: this.metrics.llm.latencies.slice(-20),
        ttsLatencies: this.metrics.tts.latencies.slice(-20),
      });
    });
  }
}

module.exports = MonitorService;
