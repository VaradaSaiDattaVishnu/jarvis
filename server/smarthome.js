// J.A.R.V.I.S — Smart Home Service (Home Assistant REST API)

class SmartHomeService {
  constructor() {
    this.baseUrl = process.env.HOME_ASSISTANT_URL;
    this.token = process.env.HOME_ASSISTANT_TOKEN;
    this.ready = !!(this.baseUrl && this.token);

    if (this.ready) {
      console.log(`🏠 Smart Home connected (${this.baseUrl})`);
    } else {
      console.log('🏠 Smart Home not configured (set HOME_ASSISTANT_URL, HOME_ASSISTANT_TOKEN)');
    }
  }

  needsSmartHome(text) {
    const lower = text.toLowerCase();
    const triggers = [
      'turn on', 'turn off', 'lights', 'light', 'thermostat',
      'temperature', 'fan', 'lock', 'unlock', 'door',
      'garage', 'switch', 'dim', 'brighten', 'smart home',
      'home assistant', 'devices', 'scene',
    ];
    return triggers.some(t => lower.includes(t));
  }

  async _request(method, endpoint, body = null) {
    if (!this.ready) return { error: 'Smart home not configured' };

    const url = `${this.baseUrl}/api/${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      console.error(`Smart home API error (${endpoint}):`, e.message);
      return { error: e.message };
    }
  }

  async getDevices() {
    const states = await this._request('GET', 'states');
    if (states.error) return states;

    // Filter to common device types
    const deviceTypes = ['light', 'switch', 'fan', 'lock', 'climate', 'cover', 'media_player', 'scene'];
    return states.filter(s => {
      const domain = s.entity_id.split('.')[0];
      return deviceTypes.includes(domain);
    }).map(s => ({
      entity_id: s.entity_id,
      name: s.attributes.friendly_name || s.entity_id,
      state: s.state,
      domain: s.entity_id.split('.')[0],
      attributes: {
        brightness: s.attributes.brightness,
        temperature: s.attributes.temperature,
        current_temperature: s.attributes.current_temperature,
      },
    }));
  }

  async callService(domain, service, entityId, data = {}) {
    return this._request('POST', `services/${domain}/${service}`, {
      entity_id: entityId,
      ...data,
    });
  }

  async turnOn(entityId, data = {}) {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_on', entityId, data);
  }

  async turnOff(entityId) {
    const domain = entityId.split('.')[0];
    return this.callService(domain, 'turn_off', entityId);
  }

  async setTemperature(entityId, temperature) {
    return this.callService('climate', 'set_temperature', entityId, { temperature });
  }

  async activateScene(sceneId) {
    return this.callService('scene', 'turn_on', sceneId);
  }

  setupRoutes(app) {
    app.get('/api/smarthome/devices', async (req, res) => {
      const devices = await this.getDevices();
      res.json({ devices });
    });

    app.post('/api/smarthome/action', async (req, res) => {
      const { action, entity_id, data } = req.body;
      if (!action || !entity_id) {
        return res.status(400).json({ error: 'action and entity_id required' });
      }

      let result;
      switch (action) {
        case 'turn_on': result = await this.turnOn(entity_id, data || {}); break;
        case 'turn_off': result = await this.turnOff(entity_id); break;
        case 'set_temperature': result = await this.setTemperature(entity_id, data?.temperature); break;
        case 'activate_scene': result = await this.activateScene(entity_id); break;
        default: result = { error: `Unknown action: ${action}` };
      }

      res.json(result);
    });

    app.get('/api/smarthome/status', (req, res) => {
      res.json({ connected: this.ready, ready: this.ready, url: this.baseUrl || null });
    });
  }
}

module.exports = SmartHomeService;
