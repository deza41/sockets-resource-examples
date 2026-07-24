/**
 * ============================================================
 *  ICE SERVER CONFIG (STUN + optional TURN)
 * ============================================================
 *
 *  STUN alone lets two peers discover their public IP/port and
 *  connect when at least one side is behind a "normal" NAT. It
 *  is NOT enough for symmetric NATs, CGNAT, or strict corporate/
 *  campus firewalls — common when peers are on two different
 *  real-world networks. For those cases WebRTC needs a TURN
 *  server to relay traffic.
 *
 *  Set VITE_TURN_HOST (+ VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL)
 *  to add a TURN server on top of the public STUN servers below.
 *  One TURN host is expanded into UDP/80, TCP/80, TCP/443 and
 *  TLS/443 variants, since providers like Metered recommend
 *  offering all four so the browser can fall back past strict
 *  firewalls that block plain UDP or port 80.
 *  See client/.env.example for where to get free TURN credentials.
 * ============================================================
 */

const TURN_HOST = import.meta.env.VITE_TURN_HOST;
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME;
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL;

function turnVariants(host, username, credential) {
  return [
    `turn:${host}:80`,
    `turn:${host}:80?transport=tcp`,
    `turn:${host}:443`,
    `turns:${host}:443?transport=tcp`,
  ].map((urls) => ({ urls, username, credential }));
}

export const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    ...(TURN_HOST && TURN_USERNAME && TURN_CREDENTIAL
      ? turnVariants(TURN_HOST, TURN_USERNAME, TURN_CREDENTIAL)
      : []),
  ],
};
