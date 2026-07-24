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
 *  This mounts ExpressPeerServer on the SAME Express app/http.Server
 *  as the rest of this project (see index.js), at "/peerjs". It
 *  coexists with Socket.io on that one server because both `ws`
 *  (which ExpressPeerServer uses) and engine.io only handle
 *  upgrade requests whose URL matches their own configured path —
 *  each ignores upgrade requests meant for the other. Sharing one
 *  server/port matters on hosts like Render that only expose a
 *  single public port per service.
 *
 *  Every client-facing example (Connect 4, mesh) shares this one
 *  broker — see client/src/lib/peer.js for the matching client-side
 *  config. Reachable at "/peerjs/mesh" (this app's "/peerjs" mount
 *  prefix plus ExpressPeerServer's own `path` option, "/mesh").
 * ============================================================
 */

const { ExpressPeerServer } = require("peer");

function registerPeerServer(app, httpServer) {
  const peerServer = ExpressPeerServer(httpServer, {
    path: "/mesh",
    allow_discovery: false,
  });

  peerServer.on("connection", (client) => {
    console.log(`[/peerjs] peer connected: ${client.getId()}`);
  });

  peerServer.on("disconnect", (client) => {
    console.log(`[/peerjs] peer disconnected: ${client.getId()}`);
  });

  app.use("/peerjs", peerServer);
}

module.exports = { registerPeerServer };
