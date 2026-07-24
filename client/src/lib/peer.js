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
 *  The broker is mounted on the SAME host/port as the main
 *  Socket.io server (VITE_SERVER_URL), so host/port/secure default
 *  to whatever that URL resolves to. Override with VITE_PEERJS_*
 *  only if the broker is ever split onto a different origin.
 *
 *  `path` combines the server's app.use() mount prefix ("/peerjs")
 *  with ExpressPeerServer's own `path` option ("/mesh").
 * ============================================================
 */

import { ICE_SERVERS } from "./ice";

const SERVER_URL = new URL(import.meta.env.VITE_SERVER_URL || "http://localhost:3001");

export const PEER_SERVER_OPTS = {
  host: import.meta.env.VITE_PEERJS_HOST || SERVER_URL.hostname,
  port: Number(import.meta.env.VITE_PEERJS_PORT) || Number(SERVER_URL.port) || (SERVER_URL.protocol === "https:" ? 443 : 80),
  path: "/peerjs/mesh",
  secure: import.meta.env.VITE_PEERJS_SECURE
    ? import.meta.env.VITE_PEERJS_SECURE === "true"
    : SERVER_URL.protocol === "https:",
  config: ICE_SERVERS,
};
