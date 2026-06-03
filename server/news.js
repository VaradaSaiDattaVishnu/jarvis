// J.A.R.V.I.S — News Service (Brave Search powered)

class NewsService {
  constructor({ searchService }) {
    this.search = searchService;
    this.cache = new Map(); // query -> { headlines, timestamp }
    this.cacheDuration = 1800000; // 30 min cache
  }

  needsNews(text) {
    const lower = text.toLowerCase();
    const triggers = [
      'news', 'headlines', 'what\'s happening', 'current events',
      'what happened', 'breaking', 'latest', 'today\'s news',
      'world news', 'top stories',
    ];
    return triggers.some(t => lower.includes(t));
  }

  async getTopHeadlines(query = 'top news today') {
    // Check per-query cache
    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.headlines;
    }

    if (!this.search.braveKey) {
      return { error: 'No search API key configured' };
    }

    try {
      const results = await this.search.webSearch(query, 8);
      if (results && results.error) return { error: results.error };
      if (results && Array.isArray(results.results) && results.results.length) {
        const headlines = results.results.map(r => {
          let source = '';
          try { source = new URL(r.url).hostname.replace('www.', ''); } catch { source = ''; }
          return { title: r.title, description: r.description, url: r.url, source };
        });
        this.cache.set(query, { headlines, timestamp: Date.now() });
        return headlines;
      }
      return [];
    } catch (e) {
      console.error('News fetch failed:', e.message);
      return { error: e.message };
    }
  }

  async getPersonalizedNews(interests = []) {
    if (interests.length === 0) {
      return this.getTopHeadlines();
    }
    const query = `latest news ${interests.slice(0, 3).join(' ')}`;
    return this.getTopHeadlines(query);
  }

  formatNewsForContext(headlines) {
    if (!headlines || headlines.error || headlines.length === 0) return '';
    return '\n\n[NEWS HEADLINES]\n' +
      headlines.map(h => `- ${h.title} (${h.source})`).join('\n');
  }

  setupRoutes(app) {
    app.get('/api/news', async (req, res) => {
      const query = req.query.q || 'top news today';
      const headlines = await this.getTopHeadlines(query);
      const articles = Array.isArray(headlines) ? headlines : [];
      res.json({ articles, error: (headlines && headlines.error) || undefined });
    });

    app.get('/api/news/personalized', async (req, res) => {
      const interests = req.query.interests ? req.query.interests.split(',') : [];
      const headlines = await this.getPersonalizedNews(interests);
      const articles = Array.isArray(headlines) ? headlines : [];
      res.json({ articles, error: (headlines && headlines.error) || undefined });
    });
  }
}

module.exports = NewsService;
