// Web Search & Weather Integration
// Uses Brave Search API for web search and OpenWeatherMap for weather

const https = require('https');

class SearchService {
  constructor() {
    this.braveKey = process.env.BRAVE_SEARCH_API_KEY;
    this.weatherKey = process.env.OPENWEATHER_API_KEY;
    this.userLocation = process.env.USER_LOCATION || 'New York';
  }

  // ─── Web Search via Brave Search API ────────────────────
  async webSearch(query, count = 5) {
    if (!this.braveKey) {
      return { error: 'No Brave Search API key configured. Set BRAVE_SEARCH_API_KEY in .env' };
    }

    return new Promise((resolve, reject) => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;

      const req = https.get(url, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': this.braveKey,
        },
      }, (res) => {
        // Surface real HTTP failures (bad key 401, rate limit 429, 5xx) instead
        // of silently returning "no results".
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return resolve({ error: `Brave search HTTP ${res.statusCode}`, query });
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.web && json.web.results) {
              const results = json.web.results.slice(0, count).map(r => ({
                title: r.title,
                url: r.url,
                description: r.description,
              }));
              resolve({ results, query });
            } else {
              resolve({ results: [], query });
            }
          } catch (e) {
            reject(new Error('Failed to parse search results'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Search timeout'));
      });
    });
  }

  // Format search results for LLM context
  formatSearchResults(searchData) {
    if (searchData.error) return `\n\n[WEB SEARCH ERROR: ${searchData.error}]`;
    if (!searchData.results || searchData.results.length === 0) {
      return `\n\n[WEB SEARCH: No results found for "${searchData.query}"]`;
    }

    return '\n\n[WEB SEARCH RESULTS]\n' +
      searchData.results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.description}\n   Source: ${r.url}`
      ).join('\n');
  }

  // ─── Weather via OpenWeatherMap API ─────────────────────
  async getWeather(location = null) {
    const loc = location || this.userLocation;
    if (!this.weatherKey) {
      return { error: 'No OpenWeatherMap API key configured. Set OPENWEATHER_API_KEY in .env' };
    }

    return new Promise((resolve, reject) => {
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(loc)}&appid=${this.weatherKey}&units=metric`;

      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.cod === 200) {
              resolve({
                location: json.name,
                country: json.sys?.country,
                temp: Math.round(json.main.temp),
                feels_like: Math.round(json.main.feels_like),
                humidity: json.main.humidity,
                description: json.weather?.[0]?.description || 'unknown',
                wind_speed: json.wind?.speed,
                icon: json.weather?.[0]?.main,
              });
            } else {
              resolve({ error: json.message || 'Weather lookup failed' });
            }
          } catch (e) {
            reject(new Error('Failed to parse weather data'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Weather timeout'));
      });
    });
  }

  // Format weather for LLM context
  formatWeather(weather) {
    if (weather.error) return `\n\n[WEATHER ERROR: ${weather.error}]`;

    return `\n\n[CURRENT WEATHER — ${weather.location}, ${weather.country}]\n` +
      `- Temperature: ${weather.temp}°C (feels like ${weather.feels_like}°C)\n` +
      `- Conditions: ${weather.description}\n` +
      `- Humidity: ${weather.humidity}%\n` +
      `- Wind: ${weather.wind_speed} m/s`;
  }

  // ─── Intent Detection ──────────────────────────────────
  // Check if user message needs a web search
  needsWebSearch(text) {
    const lower = text.toLowerCase();
    const searchPatterns = [
      /what(?:'s| is) (?:the )?(?:latest|current|recent|new)/i,
      /(?:search|look up|find|google)\s+(?:for\s+)?/i,
      /(?:who|what|when|where|how) (?:is|are|was|were|did|does|do)\s/i,
      /(?:news|score|result|price|stock)\s/i,
      /tell me about\s/i,
      /what happened\s/i,
    ];
    // Exclude simple conversational questions
    const excludePatterns = [
      /what(?:'s| is) my name/i,
      /how are you/i,
      /what(?:'s| is) (?:the )?time/i,
      /what can you do/i,
      /who are you/i,
      /do you remember/i,
    ];

    if (excludePatterns.some(p => p.test(lower))) return false;
    return searchPatterns.some(p => p.test(lower));
  }

  // Check if user message is asking about weather
  needsWeather(text) {
    const lower = text.toLowerCase();
    return /\b(?:weather|temperature|forecast|rain|sunny|cold|hot|humid|wind)\b/i.test(lower) &&
      !/\bremember\b/i.test(lower);
  }

  // Extract search query from user message
  extractSearchQuery(text) {
    // Remove common prefixes
    let query = text
      .replace(/^(?:hey |ok |jarvis,?\s*)/i, '')
      .replace(/^(?:can you |could you |please )?\s*(?:search|look up|find|google)\s+(?:for\s+)?/i, '')
      .replace(/^(?:what(?:'s| is) (?:the )?)/i, '')
      .replace(/^(?:tell me about )/i, '')
      .trim();
    return query || text;
  }
}

module.exports = SearchService;
