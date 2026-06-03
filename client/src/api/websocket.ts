import type { WSMessage } from '../types';

type WSListener = (msg: WSMessage) => void;

class JarvisWebSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<WSListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private url: string;
  private intentionalClose = false;

  constructor() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.DEV ? 'localhost:3000' : window.location.host;
    this.url = `${proto}//${host}`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.intentionalClose = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WSMessage;
        this.listeners.forEach((fn) => fn(msg));
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      // Don't fight an explicit disconnect() with a reconnect loop (#30).
      if (!this.intentionalClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.intentionalClose || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(listener: WSListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const ws = new JarvisWebSocket();
