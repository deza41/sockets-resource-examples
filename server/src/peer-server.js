/**
 * ============================================================
 *  PEERJS SIGNALING SERVER  —  Express broker for WebRTC clients
 * ============================================================
 *
 *  PeerJS still needs *a* signaling server to broker the WebRTC
 *  offer/answer/ICE handshake — it just ships with its own
 *  (the `peer` npm package's `ExpressPeerServer`) instead of you
 *  writing one by hand like /signaling does for the raw-WebRTC
 *  mesh examples.
 *
 *  This mounts ExpressPeerServer as ordinary Express middleware —
 *  but on its OWN dedicated Express app + http.Server + port,
 *  not the main API server's. Reason: `ExpressPeerServer` sets up
 *  a raw `ws` WebSocket server under the hood, and having two
 *  independent WebSocket implementations (`ws` here, engine.io
 *  for Socket.io) both listening for "upgrade" events on the SAME
 *  http.Server corrupts each other's handshakes. A dedicated
 *  server sidesteps that entirely while still being "an Express
 *  peer server" in the way ExpressPeerServer is meant to be used.
 *
 *  Every client-facing example (chat, Connect 4, ...) shares this
 *  one broker — see client/src/lib/peer.js for the matching
 *  client-side config.
 *
 *  Reachable at ws://localhost:3002/peerjs/mesh — that's the
 *  app.use() mount prefix ("/peerjs") plus this server's own
 *  `path` option ("/mesh").
 * ============================================================
 */

const express = require("express");
const http = require("http");
const { ExpressPeerServer } = require("peer");

const PEER_PORT = process.env.PEERJS_PORT || 3002;

function registerPeerServer() {
  const peerApp = express();
  const peerHttpServer = http.createServer(peerApp);

  const peerServer = ExpressPeerServer(peerHttpServer, {
    path: "/mesh",
    allow_discovery: false,
  });

  peerServer.on("connection", (client) => {
    console.log(`[/peerjs] peer connected: ${client.getId()}`);
  });

  peerServer.on("disconnect", (client) => {
    console.log(`[/peerjs] peer disconnected: ${client.getId()}`);
  });

  peerApp.use("/peerjs", peerServer);

  peerHttpServer.listen(PEER_PORT, () => {
    console.log(`   /peerjs     — Express PeerJS broker on http://localhost:${PEER_PORT}/peerjs/mesh`);
  });
}

module.exports = { registerPeerServer };
