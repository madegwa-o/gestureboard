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

let sharedState = null;
let nextClientId = 1;

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

function broadcast(message, excludeSocket = null) {
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client !== excludeSocket && client.readyState === 1) {
      client.send(payload);
    }
  }
}

wss.on('connection', (socket) => {
  const clientId = `u${nextClientId++}`;
  socket.send(JSON.stringify({ type: 'welcome', clientId }));

  if (sharedState) {
    socket.send(JSON.stringify({ type: 'state', state: sharedState }));
  }

  socket.on('message', (rawData) => {
    let message;
    try {
      message = JSON.parse(rawData.toString());
    } catch {
      return;
    }

    if (message.type === 'request-sync') {
      if (sharedState) {
        socket.send(JSON.stringify({ type: 'state', state: sharedState }));
      }
      return;
    }

    if (message.type === 'state' && message.state && Array.isArray(message.state.polygons)) {
      sharedState = message.state;
      broadcast({ type: 'state', state: sharedState }, socket);
    }
  });
});

server.listen(PORT, () => {
  console.log(`GestureBoard server listening on http://localhost:${PORT}`);
});
