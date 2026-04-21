# GestureBoard

GestureBoard is a webcam-driven drawing board with hand-gesture controls. It now includes a WebSocket collaboration backend so multiple users can share the same canvas state in real time.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:8080` in one or more browser windows (or on multiple devices on the same network).

## Collaboration notes

- The Node server serves the static app and hosts the WebSocket backend on the same port.
- Finalized drawing state is broadcast to all connected clients.
- New clients receive the current shared board snapshot when they connect.
- Collaboration now supports room separation (each room has isolated users + board state).
- You can override the socket URL with a `ws` query parameter, for example:

```text
http://localhost:8080/?ws=ws://localhost:8080
```

You can also preselect room and tracking preset from the URL:

```text
http://localhost:8080/?room=demo-team&preset=stable
```
