/**
 * ============================================================
 *  NAMESPACE: /signaling  —  WebRTC Signaling Relay
 * ============================================================
 *
 *  WHAT IS SIGNALING?
 *  ──────────────────
 *  WebRTC lets browsers connect DIRECTLY to each other (peer-to-peer),
 *  but before that direct connection is established, the two peers need
 *  to exchange metadata:
 *    1. SDP Offer / Answer  — describes codec & media capabilities
 *    2. ICE Candidates      — describes network paths (IP:port pairs)
 *
 *  A "signaling server" is just a relay for those messages.  Once the
 *  two peers have exchanged their SDP and ICE candidates, the signaling
 *  server is no longer involved — all data flows peer-to-peer.
 *
 *  This server supports a MESH topology: every peer connects to every
 *  other peer, meaning N peers = N*(N-1)/2 connections.  Works well
 *  for small groups (2-4 people).
 *
 *  CONCEPTS DEMONSTRATED
 *  ─────────────────────
 *  • Signaling room  — a Socket.io room that groups peers
 *  • Forwarding SDP  — relaying offer/answer between peers
 *  • Forwarding ICE  — relaying ICE candidates between peers
 *  • Peer registry   — tracking who is in which "call"
 *
 *  CLIENT EVENTS (sent from client → server)
 *  ──────────────────────────────────────────
 *  join_call     { callId, peerId }
 *  leave_call    { callId, peerId }
 *  offer         { callId, to, from, sdp }
 *  answer        { callId, to, from, sdp }
 *  ice_candidate { callId, to, from, candidate }
 *
 *  SERVER EVENTS (emitted from server → client)
 *  ─────────────────────────────────────────────
 *  peer_joined   { peerId, socketId }
 *  peer_left     { peerId, socketId }
 *  peers_in_call { peers: Array<{ peerId, socketId }> }
 *  offer         { from, sdp }
 *  answer        { from, sdp }
 *  ice_candidate { from, candidate }
 * ============================================================
 */

// callId → Map<socketId, peerId>
const calls = new Map();

function registerSignaling(io) {
  const signaling = io.of("/signaling");

  signaling.on("connection", (socket) => {
    console.log(`[/signaling] socket connected: ${socket.id}`);

    // ── join_call ────────────────────────────────────────────
    // A peer wants to join a "call room".  We:
    //  1. Add them to the Socket.io room so they receive broadcasts
    //  2. Register them in our call registry
    //  3. Tell them about everyone already in the call (so they can
    //     initiate offers to each existing peer)
    //  4. Tell everyone else a new peer joined (so they can prepare
    //     to accept an incoming offer)
    socket.on("join_call", ({ callId, peerId }) => {
      socket.join(callId);

      if (!calls.has(callId)) calls.set(callId, new Map());
      const callPeers = calls.get(callId);

      // Send existing peer list to the new joiner BEFORE registering
      // them, so we don't include themselves in the list.
      const existingPeers = Array.from(callPeers.entries()).map(
        ([sid, pid]) => ({ socketId: sid, peerId: pid })
      );
      socket.emit("peers_in_call", { peers: existingPeers });

      // Register the new peer
      callPeers.set(socket.id, peerId);
      socket.data.callId = callId;
      socket.data.peerId = peerId;

      // Notify everyone else that a new peer has joined.
      // They will initiate an offer to this newcomer.
      socket.to(callId).emit("peer_joined", {
        peerId,
        socketId: socket.id,
      });

      console.log(`[/signaling] ${peerId} joined call: ${callId}`);
    });

    // ── leave_call ───────────────────────────────────────────
    socket.on("leave_call", ({ callId, peerId }) => {
      _handleLeave(socket, callId, peerId, signaling);
    });

    // ── offer ────────────────────────────────────────────────
    // Caller → Callee: "Here is my SDP offer describing what I support"
    // We simply relay it to the target socket.
    socket.on("offer", ({ callId, to, from, sdp }) => {
      signaling.to(to).emit("offer", { from, sdp });
    });

    // ── answer ───────────────────────────────────────────────
    // Callee → Caller: "Here is my SDP answer"
    socket.on("answer", ({ callId, to, from, sdp }) => {
      signaling.to(to).emit("answer", { from, sdp });
    });

    // ── ice_candidate ────────────────────────────────────────
    // Both sides send ICE candidates to each other.
    // An ICE candidate is essentially a network path (IP + port).
    // The browser generates several (local, STUN-reflexive, TURN)
    // and we relay them all until the peers find a path that works.
    socket.on("ice_candidate", ({ callId, to, from, candidate }) => {
      signaling.to(to).emit("ice_candidate", { from, candidate });
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      const { callId, peerId } = socket.data;
      if (callId && peerId) {
        _handleLeave(socket, callId, peerId, signaling);
      }
      console.log(`[/signaling] socket disconnected: ${socket.id}`);
    });
  });
}

// Shared leave logic used by both explicit leave_call and disconnect
function _handleLeave(socket, callId, peerId, signaling) {
  socket.leave(callId);

  const callPeers = calls.get(callId);
  if (callPeers) {
    callPeers.delete(socket.id);
    if (callPeers.size === 0) calls.delete(callId);
  }

  signaling.to(callId).emit("peer_left", {
    peerId,
    socketId: socket.id,
  });

  console.log(`[/signaling] ${peerId} left call: ${callId}`);
}

module.exports = { registerSignaling };
