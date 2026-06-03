// J.A.R.V.I.S — Music Service (Spotify Web API)

class MusicService {
  constructor() {
    this.clientId = process.env.SPOTIFY_CLIENT_ID;
    this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/api/spotify/callback';
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = 0;
    this.ready = !!(this.clientId && this.clientSecret);

    if (this.ready) {
      console.log('🎵 Spotify service ready (needs user auth)');
    } else {
      console.log('🎵 Spotify not configured (set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)');
    }
  }

  needsMusic(text) {
    const lower = text.toLowerCase();
    const triggers = [
      'play music', 'play song', 'play some', 'spotify',
      'what\'s playing', 'now playing', 'pause music', 'skip',
      'next song', 'previous', 'resume music', 'stop music',
      'recommend music', 'music for', 'playlist',
    ];
    return triggers.some(t => lower.includes(t));
  }

  get authenticated() {
    return this.accessToken && Date.now() < this.tokenExpiry;
  }

  async _refreshAccessToken() {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
        }),
      });

      const data = await response.json();
      if (data.access_token) {
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
        if (data.refresh_token) this.refreshToken = data.refresh_token;
        return true;
      }
    } catch (e) {
      console.error('Spotify token refresh failed:', e.message);
    }
    return false;
  }

  async _api(method, endpoint, body = null) {
    if (!this.authenticated) {
      const refreshed = await this._refreshAccessToken();
      if (!refreshed) return { error: 'Not authenticated with Spotify' };
    }

    const options = {
      method,
      headers: { 'Authorization': `Bearer ${this.accessToken}` },
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, options);
      if (response.status === 204) return { success: true };
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      return { error: e.message };
    }
  }

  async getNowPlaying() {
    return this._api('GET', 'me/player/currently-playing');
  }

  async play(uri = null) {
    const body = uri ? { uris: [uri] } : undefined;
    return this._api('PUT', 'me/player/play', body);
  }

  async pause() {
    return this._api('PUT', 'me/player/pause');
  }

  async next() {
    return this._api('POST', 'me/player/next');
  }

  async previous() {
    return this._api('POST', 'me/player/previous');
  }

  async search(query, type = 'track', limit = 5) {
    return this._api('GET', `search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
  }

  async getRecommendations(mood = 'neutral') {
    const moodSeeds = {
      happy: { energy: 0.8, valence: 0.9 },
      sad: { energy: 0.3, valence: 0.2 },
      energetic: { energy: 1.0, valence: 0.7 },
      calm: { energy: 0.2, valence: 0.5 },
      focused: { energy: 0.5, valence: 0.4 },
      neutral: { energy: 0.5, valence: 0.5 },
    };
    const params = moodSeeds[mood] || moodSeeds.neutral;
    return this._api('GET',
      `recommendations?seed_genres=pop,rock,electronic&target_energy=${params.energy}&target_valence=${params.valence}&limit=10`
    );
  }

  setupRoutes(app) {
    // OAuth flow
    app.get('/api/spotify/auth', (req, res) => {
      if (!this.ready) return res.status(503).json({ error: 'Spotify not configured' });
      const scopes = 'user-read-currently-playing user-modify-playback-state user-read-playback-state';
      const authUrl = `https://accounts.spotify.com/authorize?` +
        `client_id=${this.clientId}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}`;
      res.redirect(authUrl);
    });

    app.get('/api/spotify/callback', async (req, res) => {
      const { code } = req.query;
      if (!code) return res.status(400).send('No code provided');

      try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64'),
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri,
          }),
        });

        const data = await response.json();
        if (data.access_token) {
          this.accessToken = data.access_token;
          this.refreshToken = data.refresh_token;
          this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000;
          res.send('<html><body><h2>Spotify connected! You can close this tab.</h2><script>window.close()</script></body></html>');
        } else {
          res.status(400).json({ error: 'Failed to get token' });
        }
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/spotify/now-playing', async (req, res) => {
      const result = await this.getNowPlaying();
      res.json(result || { playing: false });
    });

    app.post('/api/spotify/play', async (req, res) => {
      const result = await this.play(req.body.uri);
      res.json(result);
    });

    app.post('/api/spotify/pause', async (req, res) => {
      const result = await this.pause();
      res.json(result);
    });

    app.post('/api/spotify/next', async (req, res) => {
      const result = await this.next();
      res.json(result);
    });

    app.post('/api/spotify/search', async (req, res) => {
      const { query, type } = req.body;
      if (!query) return res.status(400).json({ error: 'query required' });
      const result = await this.search(query, type || 'track');
      if (result.error) return res.json({ results: [], error: result.error });
      res.json({ results: result.tracks?.items || result.artists?.items || [] });
    });

    app.get('/api/spotify/recommendations', async (req, res) => {
      const mood = req.query.mood || 'neutral';
      const result = await this.getRecommendations(mood);
      res.json(result);
    });

    app.get('/api/spotify/status', (req, res) => {
      res.json({ ready: this.ready, authenticated: this.authenticated });
    });
  }
}

module.exports = MusicService;
