/**
 * ============================================================
 *  EXAMPLE: P2P Mesh Chat with PeerJS
 * ============================================================
 *
 *  Same mesh-chat idea as MeshApp.jsx, but the raw WebRTC
 *  plumbing — RTCPeerConnection, SDP offer/answer, ICE candidate
 *  exchange — is replaced by the `peerjs` library. It wraps all
 *  of that behind two calls: `peer.connect(id)` to open a
 *  connection, and `peer.on("connection", ...)` to accept one.
 *
 *  PeerJS still needs *some* signaling server to broker that
 *  handshake — it just ships with its own (self-hosted Express
 *  broker, see server/src/peer-server.js) instead of you writing
 *  one. What it does NOT solve is presence: knowing which peer
 *  IDs exist in a "room". So we still reuse the same /signaling
 *  Socket.io namespace as MeshApp for join/leave announcements —
 *  we just never send it an offer/answer/ice_candidate here;
 *  PeerJS's own server handles that part entirely on its own.
 *
 *  FLOW (compare to MeshApp.jsx's comment block)
 *  ────────────────────────────────────────────
 *  1. new Peer(id, { host, port, path })  → connects to our
 *     self-hosted PeerServer under that id
 *  2. socket.emit("join_call", ...)        → announce presence
 *  3. peer_joined   → we call peer.connect(remoteId)  (initiator)
 *     peers_in_call → we just wait; the existing peer will
 *                     connect to US (their peer_joined fires)
 *  4. conn.on("open") → conn.send(...) / conn.on("data", ...)
 *     — no server involved once this fires
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import Peer from "peerjs";
import { signalingSocket } from "../lib/sockets";
import { PEER_SERVER_OPTS } from "../lib/peer";

// PeerJS ids must be unique on the PeerServer, so we turn a
// human-friendly name into "name-x7f2q".
function toPeerId(name) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "peer";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function PeerJsMeshApp() {
  const [displayName, setDisplayName] = useState("");
  const [callId, setCallId] = useState("peerjs-room-1");
  const [joined, setJoined] = useState(false);
  const [roster, setRoster] = useState([]); // [{ peerId, socketId, connState }]
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("disconnected"); // our connection to the PeerServer

  const peerRef = useRef(null);
  const myPeerIdRef = useRef("");
  const connections = useRef({}); // peerId → DataConnection
  const bottomRef = useRef(null);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // ── Wire event handlers onto a DataConnection ──────────────
  // `conn.peer` is the remote PeerJS id — PeerJS hands it to us
  // directly, so unlike MeshApp there's no socketId→peerId lookup
  // to maintain here at all.
  const wireUpConnection = useCallback(
    (conn) => {
      const remotePeerId = conn.peer;

      conn.on("open", () => {
        setRoster((prev) =>
          prev.map((p) => (p.peerId === remotePeerId ? { ...p, connState: "connected" } : p))
        );
        addMessage({
          system: true,
          message: `✅ P2P channel opened with ${remotePeerId}`,
          timestamp: new Date().toISOString(),
        });
      });

      conn.on("close", () => {
        addMessage({
          system: true,
          message: `❌ P2P channel with ${remotePeerId} closed`,
          timestamp: new Date().toISOString(),
        });
      });

      conn.on("data", (data) => {
        addMessage({ ...data, from: remotePeerId });
      });

      conn.on("error", (err) => console.error("[PeerJS] connection error:", err));
    },
    [addMessage]
  );

  // ── Signaling: presence only (no offer/answer/ICE here) ────
  // Deliberately has no dependency on frequently-changing state
  // (roster, messages, ...) so it only runs once per mount —
  // see MeshApp.jsx for what happens when that rule is broken.
  useEffect(() => {
    // NOTE: deliberately not calling setJoined(false) on disconnect — the
    // signaling socket going down only means new peers can't be discovered;
    // any DataConnections already open (through the separate PeerJS broker)
    // are unaffected and keep working, so the chat UI should stay put.

    signalingSocket.on("peer_joined", ({ peerId, socketId }) => {
      setRoster((prev) => [...prev, { peerId, socketId, connState: "connecting" }]);
      addMessage({
        system: true,
        message: `👋 ${peerId} joined the call`,
        timestamp: new Date().toISOString(),
      });
      // We're the existing peer — initiate the connection to the newcomer.
      const conn = peerRef.current.connect(peerId);
      wireUpConnection(conn);
      connections.current[peerId] = conn;
    });

    signalingSocket.on("peers_in_call", ({ peers: existingPeers }) => {
      existingPeers.forEach(({ peerId, socketId }) => {
        setRoster((prev) => [...prev, { peerId, socketId, connState: "connecting" }]);
      });
      // We're the newcomer — each existing peer will connect to US
      // (handled by peer.on("connection", ...) in handleJoin).
    });

    signalingSocket.on("peer_left", ({ peerId, socketId }) => {
      connections.current[peerId]?.close();
      delete connections.current[peerId];
      setRoster((prev) => prev.filter((p) => p.socketId !== socketId));
      addMessage({
        system: true,
        message: `👋 ${peerId} left the call`,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      Object.values(connections.current).forEach((c) => c.close());
      connections.current = {};
      peerRef.current?.destroy();

      signalingSocket.off("disconnect");
      signalingSocket.off("peer_joined");
      signalingSocket.off("peers_in_call");
      signalingSocket.off("peer_left");
      signalingSocket.disconnect();
    };
  }, [addMessage, wireUpConnection]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleJoin(e) {
    e.preventDefault();
    if (!displayName.trim()) return;

    setStatus("connecting");
    const fullId = toPeerId(displayName);
    myPeerIdRef.current = fullId;

    const peer = new Peer(fullId, PEER_SERVER_OPTS);
    peerRef.current = peer;

    // Incoming connection from a peer who was already in the room
    // when we joined — they initiated, we just accept.
    peer.on("connection", (conn) => {
      wireUpConnection(conn);
      connections.current[conn.peer] = conn;
    });

    peer.on("open", (id) => {
      setStatus("connected");
      signalingSocket.connect();
      signalingSocket.emit("join_call", { callId, peerId: id });
      setJoined(true);
      addMessage({
        system: true,
        message: `You joined call: ${callId} as ${id}`,
        timestamp: new Date().toISOString(),
      });
    });

    peer.on("disconnected", () => setStatus("disconnected"));
    peer.on("error", (err) => {
      console.error("[PeerJS] error:", err);
      addMessage({
        system: true,
        message: `⚠️ PeerJS error: ${err.type || err.message}`,
        timestamp: new Date().toISOString(),
      });
    });
  }

  // ── Send a message to ALL peers via DataConnections ────────
  function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) return;

    const payload = { message, timestamp: new Date().toISOString() };

    let sent = 0;
    Object.values(connections.current).forEach((conn) => {
      if (conn.open) {
        conn.send(payload);
        sent++;
      }
    });

    addMessage({ ...payload, from: "You" });

    if (sent === 0 && roster.length > 0) {
      addMessage({
        system: true,
        message: "⚠️ Connections not open yet — wait for peers to connect",
        timestamp: new Date().toISOString(),
      });
    }

    setMessage("");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>🧩 P2P Mesh Chat (PeerJS)</h2>
        <p>
          Same mesh chat as the raw-WebRTC example, but <code>peerjs</code>{" "}
          handles the offer/answer/ICE dance for you. Open a few tabs and
          compare this file to MeshApp.jsx.
        </p>
        <span className={`badge ${status === "connected" ? "connected" : status === "connecting" ? "info" : "disconnected"}`}>
          {status}
        </span>
      </div>

      {!joined ? (
        <form className="join-form" onSubmit={handleJoin}>
          <h3>Join the Mesh</h3>
          <input
            placeholder="Your name (e.g. alice)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            placeholder="Call / room ID"
            value={callId}
            onChange={(e) => setCallId(e.target.value)}
          />
          <button type="submit">Join Mesh</button>
        </form>
      ) : (
        <div className="chat-layout">
          <aside className="user-list">
            <h4>Peers ({roster.length})</h4>
            {roster.length === 0 && <p className="hint">Waiting for others to join…</p>}
            {roster.map((p) => (
              <div key={p.socketId} className="user-item">
                <div>{p.connState === "connected" ? "🟢" : "🟡"} {p.peerId}</div>
                <div className="peer-status">{p.connState}</div>
              </div>
            ))}
            <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#888" }}>
              <div>Your peer ID: <strong>{myPeerIdRef.current}</strong></div>
              <div>Call: <strong>{callId}</strong></div>
            </div>
          </aside>

          <div className="chat-panel">
            <div className="messages">
              {messages.map((msg, i) =>
                msg.system ? (
                  <div key={i} className="msg system">
                    {msg.message}
                  </div>
                ) : (
                  <div key={i} className={`msg ${msg.from === "You" ? "mine" : "theirs"}`}>
                    <span className="msg-author">{msg.from}</span>
                    <span className="msg-text">{msg.message}</span>
                    <span className="msg-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                )
              )}
              <div ref={bottomRef} />
            </div>

            <form className="message-form" onSubmit={handleSend}>
              <input
                placeholder="Message all peers (P2P — no server)…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button type="submit">Send P2P</button>
            </form>
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>MeshApp.jsx vs PeerJS:</strong>
        <pre>{`// MeshApp.jsx: manual WebRTC signaling (~15 lines, abridged)
const pc = new RTCPeerConnection(ICE_SERVERS);
const channel = pc.createDataChannel("chat");
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
signalingSocket.emit("offer", { to, sdp: pc.localDescription });
// ...then wait for "answer", exchange ICE candidates one by one...

// PeerJsMeshApp.jsx: peerjs does all of the above internally
const conn = peer.connect(remotePeerId);
conn.on("open", () => conn.send({ message: "Hello!" }));

// Both still need a *presence* channel (who's in the room) —
// that's the only reason /signaling is used on this page.`}</pre>
      </div>
    </div>
  );
}
