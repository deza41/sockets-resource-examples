/**
 * ============================================================
 *  PEERJS BROKER CONFIG
 * ============================================================
 *
 *  Config for the self-hosted Express PeerJS broker (see
 *  server/src/peer-server.js). Every peerjs example page shares
 *  this one broker — it only brokers the initial WebRTC handshake,
 *  same as it would if you pointed at PeerJS's public cloud server.
 *
 *  `path` combines the server's app.use() mount prefix ("/peerjs")
 *  with ExpressPeerServer's own `path` option ("/mesh").
 * ============================================================
 */

export const PEER_SERVER_OPTS = {
  host: import.meta.env.VITE_PEERJS_HOST || "localhost",
  port: Number(import.meta.env.VITE_PEERJS_PORT) || 3002,
  path: "/peerjs/mesh",
  secure: import.meta.env.VITE_PEERJS_SECURE === "true",
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  },
};
