'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const roomStates = new Map();
let nextClientId = 1;
const WRITE_PASSWORD = '1234';
const clients = new Map();

const server = http.createServer((req, res) => {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const safePath = path.normalize(decodeURIComponent(reqPath)).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function normalizeRoomId(roomId) {
  const raw = String(roomId || 'main').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9_-]/g, '-').slice(0, 24);
  return cleaned || 'main';
}

function usersForRoom(roomId) {
  return Array.from(clients.values())
    .filter(client => client.roomId === roomId)
    .map(client => ({
      clientId: client.clientId,
      username: client.username,
      canWrite: client.canWrite,
    }));
}

function broadcastToRoom(roomId, message, excludeSocket = null) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    const clientMeta = clients.get(client);
    if (client !== excludeSocket && client.readyState === 1 && clientMeta?.roomId === roomId) {
      client.send(payload);
    }
  }
}

wss.on('connection', (socket) => {
  const clientId = `u${nextClientId++}`;
  socket.send(JSON.stringify({ type: 'welcome', clientId }));
  clients.set(socket, { clientId, username: `Guest-${clientId}`, canWrite: false, roomId: 'main' });

  socket.on('message', (rawData) => {
    let message;
    try {
      message = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    if (message.type === 'join') {
      const username = String(message.username || '').trim().slice(0, 24) || `Guest-${clientId}`;
      const canWrite = message.password === WRITE_PASSWORD;
      const roomId = normalizeRoomId(message.roomId);
      clients.set(socket, { clientId, username, canWrite, roomId });
      socket.send(JSON.stringify({ type: 'auth', canWrite }));
      const state = roomStates.get(roomId);
      if (state) {
        socket.send(JSON.stringify({ type: 'state', state }));
      }
      broadcastToRoom(roomId, {
        type: 'users',
        users: usersForRoom(roomId),
      });
      return;
    }

    if (message.type === 'request-sync') {
      const roomId = normalizeRoomId(message.roomId || clients.get(socket)?.roomId);
      const state = roomStates.get(roomId);
      if (state) {
        socket.send(JSON.stringify({ type: 'state', state }));
      }
      socket.send(JSON.stringify({ type: 'users', users: usersForRoom(roomId) }));
      return;
    }

    if (message.type === 'state' && message.state && Array.isArray(message.state.polygons)) {
      const client = clients.get(socket);
      if (!client || !client.canWrite) return;
      const roomId = client.roomId;
      roomStates.set(roomId, message.state);
      broadcastToRoom(roomId, { type: 'state', state: message.state }, socket);
    }
  });

  socket.on('close', () => {
    const prev = clients.get(socket);
    clients.delete(socket);
    if (!prev) return;
    broadcastToRoom(prev.roomId, {
      type: 'users',
      users: usersForRoom(prev.roomId),
    });
  });
});

server.listen(PORT, () => {
  console.log(`GestureBoard server listening on http://localhost:${PORT}`);
});
