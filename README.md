# 🔌 Socket.io + WebRTC Examples

A monorepo with a heavily-annotated **Express + Socket.io server** and a **React + Vite client** demonstrating real-world socket patterns from scratch.

---

## 📁 Project Structure

```
sockets-resource-examples/
├── package.json              # Root — npm scripts for the whole monorepo
│
├── server/                   # Express + Socket.io (port 3001)
│   ├── package.json
│   └── src/
│       ├── index.js          # Bootstrap — attaches Socket.io to Express
│       └── namespaces/
│           ├── chat.js       # Multi-room chat
│           ├── broadcast.js  # Server push / live ticker + acknowledgements
│           ├── private.js    # Direct messaging via socket ID registry
│           ├── rooms.js      # Rooms + typing indicators + read receipts
│           └── signaling.js  # WebRTC signaling relay (SDP + ICE)
│
└── client/                   # React + Vite (port 5173)
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── lib/
        │   └── sockets.js    # Singleton socket instances per namespace
        ├── pages/
        │   ├── Home.jsx
        │   ├── ChatApp.jsx          → /chat namespace
        │   ├── BroadcastApp.jsx     → /broadcast namespace
        │   ├── PrivateMessaging.jsx → /private namespace
        │   ├── RoomsApp.jsx         → /rooms namespace
        │   └── MeshApp.jsx          → WebRTC DataChannels + /signaling
        └── styles/
            ├── index.css
            └── app.css
```

---

## 🚀 Quick Start

### First time setup

```bash
npm run setup
```

This installs all dependencies for the root, server, and client in one command.

### Development (both apps at once)

```bash
npm run dev
```

Starts the Express server and Vite dev server concurrently with color-coded, labeled output:

```
[SERVER] 🚀 Server running at http://localhost:3001
[CLIENT] VITE v5.x  ready in Xms → http://localhost:5173
```

### Run individually

```bash
npm run server   # Express + nodemon on http://localhost:3001
npm run client   # Vite dev server on  http://localhost:5173
```

### Production

```bash
npm run build    # Build the React client
npm run start    # node server + vite preview (both together)
```

> **Tip:** Open 2–3 browser tabs pointing to `http://localhost:5173` to simulate multiple users.

---

## 📜 NPM Scripts Reference

| Script | Command | Description |
|---|---|---|
| `setup` | `npm run setup` | Install all deps across the monorepo (run once after cloning) |
| `dev` | `npm run dev` | Start server + client together with colored output |
| `server` | `npm run server` | Express server only (nodemon, hot-reload) |
| `client` | `npm run client` | Vite dev server only |
| `build` | `npm run build` | Production build of the React client |
| `start` | `npm run start` | Production mode — node server + vite preview |

---

## 📡 Examples

### 1. 💬 Chat App — `/chat`
**Socket.io namespace:** `/chat`

Classic multi-room chat. Demonstrates:
- `socket.join(room)` — subscribe a socket to a room
- `socket.to(room).emit(...)` — send to room, excluding sender
- `io.to(room).emit(...)` — send to room, including sender
- `socket.on("disconnect")` — cleanup on disconnect

### 2. 📡 Broadcast / Ticker — `/broadcast`
**Socket.io namespace:** `/broadcast`

Server pushes a fake BTC price to all clients every 2 seconds. Demonstrates:
- `io.emit(...)` — broadcast to ALL connected sockets
- `setInterval` — server-driven push
- **Acknowledgements** — client passes a callback as the last arg to `emit()`; the server calls it to confirm receipt

### 3. 🔒 Private Messaging — `/private`
**Socket.io namespace:** `/private`

Direct messages between users without exposing raw socket IDs. Demonstrates:
- Username → socket ID registry (in-memory `Map`)
- `io.to(socketId).emit(...)` — target exactly one socket
- Online user list management

### 4. 🚪 Rooms + Typing + Read Receipts — `/rooms`
**Socket.io namespace:** `/rooms`

Full Slack-style room system. Demonstrates:
- Dynamic room creation and listing via `io.adapter.rooms`
- `socket.rooms` — querying which rooms a socket is in
- **Typing indicators** with client-side debounce
- **Read receipts** — client emits an event when it has seen a message

### 5. 🕸️ P2P Mesh Chat — `/mesh`
**Socket.io namespace:** `/signaling` (for handshake only)

Browsers connect **directly** to each other using WebRTC DataChannels. The server is only used during the initial handshake — once connected, **no traffic goes through the server**.

| Concept | Role |
|---|---|
| `RTCPeerConnection` | Manages one P2P connection per remote peer |
| `RTCDataChannel` | Reliable TCP-like channel over P2P |
| **SDP Offer/Answer** | Describes media capabilities — exchanged via signaling server |
| **ICE Candidates** | Network paths discovered by STUN — exchanged via signaling server |
| **STUN server** | Helps discover your public IP/port behind NAT |
| **Mesh topology** | Every peer connects to every other peer directly |

---

## 🔑 Socket.io API Cheatsheet

```js
// ── Server-side ──────────────────────────────────────────────
io.emit("event", data)               // → ALL clients in namespace
io.to(room).emit("event", data)      // → ALL clients in room (incl. sender)
socket.emit("event", data)           // → THIS socket only
socket.to(room).emit("event", data)  // → room EXCEPT this socket
socket.broadcast.emit("event", data) // → everyone EXCEPT this socket
socket.join(room)                    // subscribe to a room
socket.leave(room)                   // unsubscribe from a room
socket.rooms                         // Set of rooms this socket is currently in

// ── Client-side ──────────────────────────────────────────────
socket.emit("event", data)                    // send to server
socket.emit("event", data, (ack) => { ... })  // send with acknowledgement callback
socket.on("event", (data) => { ... })         // listen for an event
socket.off("event")                           // remove listener(s)
socket.connect()                              // manually connect
socket.disconnect()                           // manually disconnect
socket.id                                     // this socket's unique ID
```

---

## 🕸️ WebRTC Signaling Flow

```
Alice                   Server (/signaling)              Bob
  |                           |                           |
  |── join_call ─────────────>|                           |
  |<─ peers_in_call (empty) ──|                           |
  |                           |<──────── join_call ───────|
  |<─ peer_joined ────────────|                           |
  |                           |──────── peer_joined ─────>|
  |                           |                           |
  |── offer (SDP) ───────────>|─────────────────────────>Bob
  |                           |<──────── answer (SDP) ────|
  |<─ answer ─────────────────|                           |
  |                           |                           |
  |── ice_candidate ─────────>|─────────────────────────>Bob
  |<─ ice_candidate ──────────|<──────── ice_candidate ───|
  |                           |                           |
  |◄══════════════ DataChannel open — fully P2P ══════════►
  |                    (server no longer involved)        |
```

Once the DataChannel is open, messages flow **peer-to-peer** — the Socket.io server receives zero traffic.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Server runtime | Node.js |
| HTTP framework | Express 4 |
| Real-time (server) | Socket.io 4 |
| Client framework | React 18 |
| Client build tool | Vite 5 |
| Real-time (client) | socket.io-client 4 |
| P2P transport | WebRTC (`RTCPeerConnection` + `RTCDataChannel`) |
| Dev tooling | nodemon, concurrently |
