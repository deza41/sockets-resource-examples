/**
 * ============================================================
 *  EXAMPLE: P2P Mesh Chat with WebRTC DataChannels
 * ============================================================
 *
 *  ARCHITECTURE OVERVIEW
 *  ─────────────────────
 *  1. Socket.io (/signaling)  — only used to exchange SDP & ICE
 *  2. RTCPeerConnection        — one per remote peer
 *  3. RTCDataChannel           — the actual P2P message channel
 *
 *  FLOW (for a 3-person call: Alice, Bob, Carol)
 *  ──────────────────────────────────────────────
 *  Alice joins:
 *    • Server says "you're alone"
 *
 *  Bob joins:
 *    • Server tells Alice "Bob joined" (peer_joined)
 *    • Alice creates RTCPeerConnection for Bob
 *    • Alice creates a DataChannel
 *    • Alice creates an SDP offer and sends it via signaling server
 *    • Bob receives the offer, creates RTCPeerConnection, sets remote SDP
 *    • Bob creates an SDP answer and sends it via signaling server
 *    • Alice sets Bob's answer as remote SDP
 *    • Both exchange ICE candidates via signaling server
 *    • DataChannel opens — server is no longer involved!
 *
 *  Carol joins:
 *    • Same process repeats between Carol↔Alice AND Carol↔Bob
 *    • Result: a full mesh (Alice↔Bob, Alice↔Carol, Bob↔Carol)
 *
 *  KEY WEBRTC CONCEPTS
 *  ────────────────────
 *  RTCPeerConnection  — manages the peer connection lifecycle
 *  RTCDataChannel     — TCP-like reliable channel over P2P
 *  SDP Offer/Answer   — describes codecs and capabilities
 *  ICE Candidates     — network paths discovered by STUN
 *  STUN server        — helps discover your public IP/port
 *                       (uses Google's public STUN here)
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { signalingSocket } from "../lib/sockets";

// Public STUN server — helps peers discover their public IP.
// In production, add TURN servers for users behind strict NATs.
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function MeshApp() {
  const [peerId, setPeerId] = useState("");
  const [callId, setCallId] = useState("mesh-room-1");
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState([]); // { peerId, socketId, status }
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("disconnected");

  // Map of socketId → RTCPeerConnection
  const peerConnections = useRef({});
  // Map of socketId → RTCDataChannel (for channels we created as initiator)
  const dataChannels = useRef({});
  const bottomRef = useRef(null);
  // Mirrors `peers` state without forcing the signaling effect to
  // re-subscribe (and disconnect!) every time someone joins/leaves.
  const peersRef = useRef([]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // ── Create a new RTCPeerConnection for a remote peer ───────
  const createPeerConnection = useCallback(
    (remoteSocketId, remotePeerId) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);

      // When we discover a local ICE candidate, send it to the remote peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          signalingSocket.emit("ice_candidate", {
            callId,
            to: remoteSocketId,
            from: signalingSocket.id,
            candidate: event.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC] ${remotePeerId} → ${pc.connectionState}`);
        setPeers((prev) =>
          prev.map((p) =>
            p.socketId === remoteSocketId
              ? { ...p, status: pc.connectionState }
              : p
          )
        );
      };

      // When a remote DataChannel is created by the other peer (answerer side)
      pc.ondatachannel = (event) => {
        const channel = event.channel;
        wireUpChannel(channel, remotePeerId);
        dataChannels.current[remoteSocketId] = channel;
      };

      peerConnections.current[remoteSocketId] = pc;
      return pc;
    },
    [callId]
  );

  // ── Wire event handlers onto a DataChannel ─────────────────
  function wireUpChannel(channel, remotePeerId) {
    channel.onopen = () => {
      addMessage({
        system: true,
        message: `✅ P2P channel opened with ${remotePeerId}`,
        timestamp: new Date().toISOString(),
      });
    };

    channel.onclose = () => {
      addMessage({
        system: true,
        message: `❌ P2P channel with ${remotePeerId} closed`,
        timestamp: new Date().toISOString(),
      });
    };

    channel.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addMessage({ ...data, from: remotePeerId });
    };
  }

  // ── Initiate connection to a newly joined peer ─────────────
  const initiateConnection = useCallback(
    async (remoteSocketId, remotePeerId) => {
      const pc = createPeerConnection(remoteSocketId, remotePeerId);

      // Create a DataChannel BEFORE the offer (so it's included in SDP)
      const channel = pc.createDataChannel("chat");
      wireUpChannel(channel, remotePeerId);
      dataChannels.current[remoteSocketId] = channel;

      // Create and set local SDP offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to remote peer via signaling server
      signalingSocket.emit("offer", {
        callId,
        to: remoteSocketId,
        from: signalingSocket.id,
        sdp: pc.localDescription,
      });
    },
    [createPeerConnection, callId]
  );

  useEffect(() => {
    signalingSocket.connect();
    signalingSocket.on("connect", () => setStatus("connected"));
    // NOTE: deliberately not calling setJoined(false) here. The signaling
    // socket going down only means new peers can't be discovered — any
    // DataChannels already open are unaffected and keep working, so we
    // shouldn't yank the chat UI away from someone mid-conversation.
    signalingSocket.on("disconnect", () => setStatus("disconnected"));

    // ── peer_joined: a new peer entered the call ──────────────
    // We are the initiator — create offer
    signalingSocket.on("peer_joined", ({ peerId: pid, socketId: sid }) => {
      setPeers((prev) => [...prev, { peerId: pid, socketId: sid, status: "new" }]);
      addMessage({
        system: true,
        message: `👋 ${pid} joined the call`,
        timestamp: new Date().toISOString(),
      });
      initiateConnection(sid, pid);
    });

    // ── peers_in_call: existing peers when we join ────────────
    // We receive this when WE join (for each person already there)
    signalingSocket.on("peers_in_call", ({ peers: existingPeers }) => {
      existingPeers.forEach(({ peerId: pid, socketId: sid }) => {
        setPeers((prev) => [...prev, { peerId: pid, socketId: sid, status: "new" }]);
      });
      // Note: existing peers will initiate offers TO us via peer_joined
    });

    // ── peer_left ─────────────────────────────────────────────
    signalingSocket.on("peer_left", ({ peerId: pid, socketId: sid }) => {
      peerConnections.current[sid]?.close();
      delete peerConnections.current[sid];
      delete dataChannels.current[sid];
      setPeers((prev) => prev.filter((p) => p.socketId !== sid));
      addMessage({
        system: true,
        message: `👋 ${pid} left the call`,
        timestamp: new Date().toISOString(),
      });
    });

    // ── offer received: we are the answerer ──────────────────
    signalingSocket.on("offer", async ({ from, sdp }) => {
      // Find which peer this offer is from
      const remotePeer = peersRef.current.find((p) => p.socketId === from);
      const pc = createPeerConnection(from, remotePeer?.peerId ?? from);

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      signalingSocket.emit("answer", {
        callId,
        to: from,
        from: signalingSocket.id,
        sdp: pc.localDescription,
      });
    });

    // ── answer received: we are the original offerer ──────────
    signalingSocket.on("answer", async ({ from, sdp }) => {
      const pc = peerConnections.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    // ── ICE candidate received ────────────────────────────────
    // Add to the peer connection so the browser can try this path
    signalingSocket.on("ice_candidate", async ({ from, candidate }) => {
      const pc = peerConnections.current[from];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("ICE candidate error:", e);
        }
      }
    });

    return () => {
      // Close all peer connections on unmount
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      dataChannels.current = {};

      signalingSocket.off("connect");
      signalingSocket.off("disconnect");
      signalingSocket.off("peer_joined");
      signalingSocket.off("peers_in_call");
      signalingSocket.off("peer_left");
      signalingSocket.off("offer");
      signalingSocket.off("answer");
      signalingSocket.off("ice_candidate");
      signalingSocket.disconnect();
    };
  }, [initiateConnection, createPeerConnection, callId]);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleJoin(e) {
    e.preventDefault();
    if (!peerId.trim()) return;
    signalingSocket.emit("join_call", { callId, peerId });
    setJoined(true);
    addMessage({
      system: true,
      message: `You joined call: ${callId}`,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Send a message to ALL peers via DataChannels ──────────
  function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) return;

    const payload = {
      message,
      timestamp: new Date().toISOString(),
    };

    // Send over every open DataChannel (no server involved!)
    let sent = 0;
    Object.values(dataChannels.current).forEach((channel) => {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(payload));
        sent++;
      }
    });

    // Show locally
    addMessage({ ...payload, from: "You" });

    if (sent === 0 && peers.length > 0) {
      addMessage({
        system: true,
        message: "⚠️ DataChannels not open yet — wait for connections to establish",
        timestamp: new Date().toISOString(),
      });
    }

    setMessage("");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>🕸️ P2P Mesh Chat (WebRTC)</h2>
        <p>
          Browsers talk directly to each other via RTCDataChannel. The server
          only helps during the initial handshake (signaling). Open 3 tabs!
        </p>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      {!joined ? (
        <form className="join-form" onSubmit={handleJoin}>
          <h3>Join the Mesh</h3>
          <input
            placeholder="Your peer ID (e.g. alice)"
            value={peerId}
            onChange={(e) => setPeerId(e.target.value)}
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
          {/* Peers sidebar */}
          <aside className="user-list">
            <h4>Peers ({peers.length})</h4>
            {peers.length === 0 && (
              <p className="hint">Waiting for others to join…</p>
            )}
            {peers.map((p) => (
              <div key={p.socketId} className="user-item">
                <div>
                  {p.status === "connected" ? "🟢" : "🟡"} {p.peerId}
                </div>
                <div className="peer-status">{p.status}</div>
              </div>
            ))}
            <div style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#888" }}>
              <div>Your peer ID: <strong>{peerId}</strong></div>
              <div>Call: <strong>{callId}</strong></div>
            </div>
          </aside>

          {/* Chat panel */}
          <div className="chat-panel">
            <div className="messages">
              {messages.map((msg, i) =>
                msg.system ? (
                  <div key={i} className="msg system">
                    {msg.message}
                  </div>
                ) : (
                  <div
                    key={i}
                    className={`msg ${msg.from === "You" ? "mine" : "theirs"}`}
                  >
                    <span className="msg-author">{msg.from}</span>
                    <span className="msg-text">{msg.message}</span>
                    <span className="msg-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
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
        <strong>Key WebRTC flow:</strong>
        <pre>{`// 1. Create peer connection
const pc = new RTCPeerConnection({ iceServers: [...] });

// 2. Create data channel (initiator only)
const channel = pc.createDataChannel("chat");

// 3. Create offer → send via signaling server
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
signalingSocket.emit("offer", { to, sdp: offer });

// 4. Answerer: receive offer, create answer
await pc.setRemoteDescription(offer);
const answer = await pc.createAnswer();
signalingSocket.emit("answer", { to, sdp: answer });

// 5. Exchange ICE candidates via signaling server
pc.onicecandidate = (e) => {
  signalingSocket.emit("ice_candidate", { candidate: e.candidate });
};

// 6. Send messages — NO server involved!
channel.send(JSON.stringify({ message: "Hello!" }));`}</pre>
      </div>
    </div>
  );
}
