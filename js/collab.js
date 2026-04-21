/**
 * collab.js — WebSocket collaboration manager.
 *
 * Synchronizes drawing state across connected clients.
 */
'use strict';

class CollabMgr {
  constructor({ onState, onStatus, onUsers, onAuth } = {}) {
    this.onState = typeof onState === 'function' ? onState : () => {};
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.onUsers = typeof onUsers === 'function' ? onUsers : () => {};
    this.onAuth = typeof onAuth === 'function' ? onAuth : () => {};

    this.socket = null;
    this.clientId = null;
    this.username = '';
    this.roomId = 'main';
    this.canWrite = false;
    this._reconnectTimer = null;
    this._lastSent = null;
    this._queuedState = null;
    this._flushTimer = null;
    this._flushIntervalMs = 60;
  }

  connect({ url = this._defaultUrl(), username = 'Guest', password = '', roomId = 'main' } = {}) {
    if (this.socket && this.socket.readyState <= 1) return;

    this.username = (username || 'Guest').trim();
    this._password = password || '';
    this.roomId = this._normalizeRoomId(roomId);

    this.onStatus({ connected: false, message: `CONNECTING ROOM ${this.roomId.toUpperCase()}…` });
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.onStatus({ connected: true, message: `ROOM ${this.roomId.toUpperCase()} ONLINE` });
      this._send({ type: 'join', username: this.username, password: this._password, roomId: this.roomId });
      this._send({ type: 'request-sync', roomId: this.roomId });
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

      if (message.type === 'auth') {
        this.canWrite = !!message.canWrite;
        this.onAuth({ canWrite: this.canWrite });
        return;
      }

      if (message.type === 'users' && Array.isArray(message.users)) {
        this.onUsers(message.users);
        return;
      }

      if (message.type === 'state' && message.state) {
        this.onState(message.state);
      }
    });

    this.socket.addEventListener('close', () => {
      this.onStatus({ connected: false, message: `ROOM ${this.roomId.toUpperCase()} OFFLINE` });
      this._scheduleReconnect(url);
    });

    this.socket.addEventListener('error', () => {
      this.onStatus({ connected: false, message: 'COLLAB ERROR' });
    });
  }

  publishState(state) {
    if (!state || !this.canWrite) return;
    this._queuedState = state;

    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this._flushQueuedState();
    }, this._flushIntervalMs);
  }

  _flushQueuedState() {
    if (!this._queuedState) return;

    const serialized = JSON.stringify(this._queuedState);
    if (serialized === this._lastSent) {
      this._queuedState = null;
      return;
    }

    this._lastSent = serialized;
    this._send({ type: 'state', roomId: this.roomId, state: this._queuedState });
    this._queuedState = null;
  }

  _send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  _scheduleReconnect(url) {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect({
        url,
        username: this.username,
        password: this._password,
        roomId: this.roomId,
      });
    }, 2000);
  }

  _normalizeRoomId(roomId) {
    const raw = String(roomId || 'main').trim().toLowerCase();
    const cleaned = raw.replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
    return cleaned || 'main';
  }

  _defaultUrl() {
    const override = new URLSearchParams(window.location.search).get('ws');
    if (override) return override;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:8080`;
  }
}
