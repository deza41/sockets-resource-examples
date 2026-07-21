/**
 * ============================================================
 *  SOCKET.IO SERVER — ENTRY POINT
 * ============================================================
 *
 *  This file bootstraps an Express HTTP server and attaches
 *  a Socket.io instance to it.  All socket "namespaces" (think
 *  of them as isolated channels) are wired up here, each one
 *  demonstrating a different real-world pattern.
 *
 *  Namespaces used in this project
 *  ─────────────────────────────────────────────────────────
 *  /chat        → classic multi-room chat app
 *  /broadcast   → server-to-all broadcast (news ticker style)
 *  /private     → private messaging between two users
 *  /rooms       → room-based grouping (think Slack channels)
 *  /signaling   → WebRTC signaling relay for peer-to-peer mesh
 *  /peerjs      → self-hosted PeerJS signaling server, on its own
 *                 port (see peer-server.js for why); used by the
 *                 mesh example built on the `peerjs` library
 *                 instead of hand-rolled offer/answer/ICE relaying
 * ============================================================
 */

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

// ── 1. Create the Express app ────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── 2. Wrap Express in a plain Node HTTP server ──────────────
//  Socket.io needs access to the raw http.Server so it can
//  upgrade HTTP connections to WebSockets.
const httpServer = http.createServer(app);

// ── 3. Attach Socket.io to the HTTP server ───────────────────
//  The `cors` option here mirrors Express's CORS config so
//  browser clients are not blocked by the same-origin policy.
const io = new Server(httpServer, {
  cors: {
    origin: "*", // In production, lock this down to your domain
    methods: ["GET", "POST"],
  },
});

// ── 4. Wire up each namespace / example ─────────────────────
const { registerChat } = require("./namespaces/chat");
const { registerBroadcast } = require("./namespaces/broadcast");
const { registerPrivateMessages } = require("./namespaces/private");
const { registerRooms } = require("./namespaces/rooms");
const { registerSignaling } = require("./namespaces/signaling");
const { registerPeerServer } = require("./peer-server");

registerChat(io);
registerBroadcast(io);
registerPrivateMessages(io);
registerRooms(io);
registerSignaling(io);

// ── 5. Simple REST health-check endpoint ────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Socket.io examples server is running",
    namespaces: ["/chat", "/broadcast", "/private", "/rooms", "/signaling"],
  });
});

// ── 6. Start listening ───────────────────────────────────────
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Socket.io namespaces ready:\n`);
  console.log(`   /chat       — Multi-room chat`);
  console.log(`   /broadcast  — Server broadcast`);
  console.log(`   /private    — Private messaging`);
  console.log(`   /rooms      — Room management`);
  console.log(`   /signaling  — WebRTC signaling relay`);
  registerPeerServer(); // starts its own listener on PEERJS_PORT (3002) and logs it
});
