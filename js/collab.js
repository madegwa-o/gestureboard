/**
 * collab.js — WebSocket collaboration manager.
 *
 * Synchronizes drawing state across connected clients.
 */
'use strict';

class CollabMgr {
  constructor({ onState, onStatus } = {}) {
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};

    this.socket = null;
    this.clientId = null;
    this._reconnectTimer = null;
    this._lastSent = null;
  }

  connect(url = this._defaultUrl()) {
    if (this.socket && this.socket.readyState <= 1) return;

    this.onStatus({ connected: false, message: 'CONNECTING COLLAB…' });
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.onStatus({ connected: true, message: 'COLLAB ONLINE' });
      this._send({ type: 'request-sync' });
    });

    this.socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'welcome') {
        this.clientId = message.clientId;
        return;
      }

      if (message.type === 'state' && message.state) {
        this.onState(message.state);
      }
    });

    this.socket.addEventListener('close', () => {
      this.onStatus({ connected: false, message: 'COLLAB OFFLINE' });
      this._scheduleReconnect(url);
    });

    this.socket.addEventListener('error', () => {
      this.onStatus({ connected: false, message: 'COLLAB ERROR' });
    });
  }

  publishState(state) {
    if (!state) return;

    const serialized = JSON.stringify(state);
    if (serialized === this._lastSent) return;
    this._lastSent = serialized;

    this._send({ type: 'state', state });
  }

  _send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  _scheduleReconnect(url) {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect(url);
    }, 2000);
  }

  _defaultUrl() {
    const override = new URLSearchParams(window.location.search).get('ws');
    if (override) return override;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:8080`;
  }
}
