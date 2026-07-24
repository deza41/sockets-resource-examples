/**
 * ============================================================
 *  EXAMPLE: P2P Mesh Game — walk around a shared map (WebRTC)
 * ============================================================
 *
 *  Same mesh-of-RTCPeerConnections pattern as MeshApp, but
 *  instead of chat messages we broadcast player position over
 *  the DataChannels at a fixed rate. The signaling server
 *  (/signaling) is reused unchanged — it doesn't care whether
 *  the SDP/ICE it relays is for a chat room or a game room.
 *
 *  KEY IDEAS
 *  ─────────
 *  • Movement is read from a `keysRef` (no React state) and
 *    advanced every animation frame — putting it in state would
 *    re-render the whole tree ~60x/sec.
 *  • Positions are written straight to the DOM via
 *    `el.style.transform`, bypassing React entirely, for the
 *    same reason. React only decides WHEN an avatar element
 *    exists (join/leave), never WHERE it is.
 *  • Each peer's spawn point + color is derived deterministically
 *    from their peerId (a simple hash), so every browser places
 *    a given player at the same spot without needing a network
 *    round trip first.
 *  • Position updates are throttled to BROADCAST_HZ, not sent on
 *    every frame — plenty smooth for a demo, far less traffic.
 * ============================================================
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import { signalingSocket } from "../lib/sockets";
import { ICE_SERVERS } from "../lib/ice";

const MAP_WIDTH = 900;
const MAP_HEIGHT = 520;
const PLAYER_SIZE = 34;
const MOVE_SPEED = 240; // px / second
const BROADCAST_HZ = 20;
const BROADCAST_INTERVAL_MS = 1000 / BROADCAST_HZ;

const COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#22d3ee", "#818cf8", "#e879f9", "#fb7185"];

const MOVE_KEYS = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1], arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0], arrowright: [1, 0],
};

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function colorForPeer(peerId) {
  return COLORS[hashString(peerId) % COLORS.length];
}

// Deterministic spawn point so every browser places a peer at the
// same spot immediately, no round trip needed.
function spawnForPeer(peerId) {
  const h = hashString(peerId);
  const x = PLAYER_SIZE + ((h % 977) / 977) * (MAP_WIDTH - 2 * PLAYER_SIZE);
  const y = PLAYER_SIZE + (((h >> 5) % 977) / 977) * (MAP_HEIGHT - 2 * PLAYER_SIZE);
  return { x, y };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export default function MeshGameApp() {
  const [peerIdInput, setPeerIdInput] = useState("");
  const [gameId, setGameId] = useState("mesh-game-1");
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const [renderIds, setRenderIds] = useState([]); // which avatars to mount
  const [roster, setRoster] = useState([]); // sidebar list: { peerId, socketId, connState }

  const peerConnections = useRef({});
  const dataChannels = useRef({});
  const players = useRef({}); // socketId ('local' for self) → { peerId, x, y, color, el }
  const peersRef = useRef([]); // mirrors roster, read inside handlers (avoids re-subscribing)
  const keysRef = useRef({});
  const rafRef = useRef(null);
  const lastBroadcastRef = useRef(0);

  const addPlayer = useCallback((socketId, peerId) => {
    const { x, y } = spawnForPeer(peerId);
    players.current[socketId] = { peerId, x, y, color: colorForPeer(peerId), el: null };
    setRenderIds((prev) => (prev.includes(socketId) ? prev : [...prev, socketId]));
  }, []);

  const removePlayer = useCallback((socketId) => {
    delete players.current[socketId];
    setRenderIds((prev) => prev.filter((id) => id !== socketId));
  }, []);

  const applyTransform = (player) => {
    if (player?.el) {
      player.el.style.transform = `translate(${player.x}px, ${player.y}px)`;
    }
  };

  // ── Create a new RTCPeerConnection for a remote peer ───────
  const createPeerConnection = useCallback((remoteSocketId, remotePeerId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signalingSocket.emit("ice_candidate", {
          callId: gameId,
          to: remoteSocketId,
          from: signalingSocket.id,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      setRoster((prev) =>
        prev.map((p) => (p.socketId === remoteSocketId ? { ...p, connState: pc.connectionState } : p))
      );
    };

    pc.ondatachannel = (event) => {
      wireUpChannel(event.channel, remoteSocketId);
      dataChannels.current[remoteSocketId] = event.channel;
    };

    peerConnections.current[remoteSocketId] = pc;
    return pc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  function wireUpChannel(channel, remoteSocketId) {
    channel.onopen = () => {
      // Sync our current position immediately so the new peer doesn't
      // have to wait for us to move before seeing where we really are.
      const local = players.current.local;
      if (local) channel.send(JSON.stringify({ x: local.x, y: local.y }));
    };
    channel.onmessage = (event) => {
      const { x, y } = JSON.parse(event.data);
      const player = players.current[remoteSocketId];
      if (player) {
        player.x = x;
        player.y = y;
        applyTransform(player);
      }
    };
  }

  const initiateConnection = useCallback(
    async (remoteSocketId, remotePeerId) => {
      const pc = createPeerConnection(remoteSocketId, remotePeerId);
      const channel = pc.createDataChannel("game");
      wireUpChannel(channel, remoteSocketId);
      dataChannels.current[remoteSocketId] = channel;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signalingSocket.emit("offer", {
        callId: gameId,
        to: remoteSocketId,
        from: signalingSocket.id,
        sdp: pc.localDescription,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [createPeerConnection, gameId]
  );

  // ── Signaling (mirrors MeshApp) ─────────────────────────────
  useEffect(() => {
    signalingSocket.connect();
    signalingSocket.on("connect", () => setStatus("connected"));
    // NOTE: deliberately not calling setJoined(false) here. The signaling
    // socket going down only means new peers can't be discovered — any
    // DataChannels already open are unaffected and keep working, so we
    // shouldn't yank the map away from someone mid-game.
    signalingSocket.on("disconnect", () => setStatus("disconnected"));

    signalingSocket.on("peer_joined", ({ peerId, socketId }) => {
      peersRef.current = [...peersRef.current, { peerId, socketId }];
      setRoster((prev) => [...prev, { peerId, socketId, connState: "new" }]);
      addPlayer(socketId, peerId);
      initiateConnection(socketId, peerId);
    });

    signalingSocket.on("peers_in_call", ({ peers: existingPeers }) => {
      existingPeers.forEach(({ peerId, socketId }) => {
        peersRef.current = [...peersRef.current, { peerId, socketId }];
        setRoster((prev) => [...prev, { peerId, socketId, connState: "new" }]);
        addPlayer(socketId, peerId);
      });
      // Existing peers will initiate offers TO us via peer_joined.
    });

    signalingSocket.on("peer_left", ({ socketId }) => {
      peerConnections.current[socketId]?.close();
      delete peerConnections.current[socketId];
      delete dataChannels.current[socketId];
      peersRef.current = peersRef.current.filter((p) => p.socketId !== socketId);
      setRoster((prev) => prev.filter((p) => p.socketId !== socketId));
      removePlayer(socketId);
    });

    signalingSocket.on("offer", async ({ from, sdp }) => {
      const remotePeer = peersRef.current.find((p) => p.socketId === from);
      const pc = createPeerConnection(from, remotePeer?.peerId ?? from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signalingSocket.emit("answer", {
        callId: gameId,
        to: from,
        from: signalingSocket.id,
        sdp: pc.localDescription,
      });
    });

    signalingSocket.on("answer", async ({ from, sdp }) => {
      const pc = peerConnections.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    });

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
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      peerConnections.current = {};
      dataChannels.current = {};
      players.current = {};
      peersRef.current = [];

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
    // Deliberately NOT depending on `roster` — reconnecting on every
    // player join/leave would tear down every open DataChannel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiateConnection, createPeerConnection, gameId, addPlayer, removePlayer]);

  // ── Keyboard input ──────────────────────────────────────────
  useEffect(() => {
    if (!joined) return;
    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (MOVE_KEYS[key]) {
        e.preventDefault();
        keysRef.current[key] = true;
      }
    };
    const onKeyUp = (e) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      keysRef.current = {};
    };
  }, [joined]);

  // ── Game loop: move local player, broadcast at BROADCAST_HZ ─
  useEffect(() => {
    if (!joined) return;
    let lastFrame = performance.now();

    const tick = (now) => {
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;

      const local = players.current.local;
      if (local) {
        let dx = 0, dy = 0;
        for (const key in keysRef.current) {
          if (keysRef.current[key] && MOVE_KEYS[key]) {
            dx += MOVE_KEYS[key][0];
            dy += MOVE_KEYS[key][1];
          }
        }
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy) || 1;
          local.x = clamp(local.x + (dx / len) * MOVE_SPEED * dt, 0, MAP_WIDTH - PLAYER_SIZE);
          local.y = clamp(local.y + (dy / len) * MOVE_SPEED * dt, 0, MAP_HEIGHT - PLAYER_SIZE);
          applyTransform(local);
        }

        if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL_MS) {
          lastBroadcastRef.current = now;
          const payload = JSON.stringify({ x: local.x, y: local.y });
          Object.values(dataChannels.current).forEach((ch) => {
            if (ch.readyState === "open") ch.send(payload);
          });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [joined]);

  function handleJoin(e) {
    e.preventDefault();
    if (!peerIdInput.trim()) return;
    const { x, y } = spawnForPeer(peerIdInput);
    players.current.local = { peerId: peerIdInput, x, y, color: colorForPeer(peerIdInput), el: null };
    setRenderIds((prev) => [...prev, "local"]);
    signalingSocket.emit("join_call", { callId: gameId, peerId: peerIdInput });
    setJoined(true);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>🎮 P2P Mesh Game (WebRTC)</h2>
        <p>
          Same mesh-of-RTCPeerConnections as the chat example, but positions
          fly over the DataChannels instead of messages. Open a few tabs and
          walk around together — WASD or arrow keys.
        </p>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      {!joined ? (
        <form className="join-form" onSubmit={handleJoin}>
          <h3>Join the Map</h3>
          <input
            placeholder="Your peer ID (e.g. alice)"
            value={peerIdInput}
            onChange={(e) => setPeerIdInput(e.target.value)}
          />
          <input
            placeholder="Game / room ID"
            value={gameId}
            onChange={(e) => setGameId(e.target.value)}
          />
          <button type="submit">Join Game</button>
        </form>
      ) : (
        <div className="chat-layout">
          <aside className="user-list">
            <h4>Players ({renderIds.length})</h4>
            <div className="user-item me">🟢 {peerIdInput} (you)</div>
            {roster.map((p) => (
              <div key={p.socketId} className="user-item">
                <div>{p.connState === "connected" ? "🟢" : "🟡"} {p.peerId}</div>
                <div className="peer-status">{p.connState}</div>
              </div>
            ))}
            <div className="hint" style={{ marginTop: "1rem" }}>
              Move: <strong>WASD</strong> or <strong>Arrow keys</strong>
            </div>
          </aside>

          <div className="chat-panel">
            <div className="game-map">
              {renderIds.map((id) => {
                const p = players.current[id];
                if (!p) return null;
                return (
                  <div
                    key={id}
                    ref={(el) => {
                      if (el) {
                        p.el = el;
                        applyTransform(p);
                      }
                    }}
                    className="game-avatar"
                    style={{ background: p.color }}
                    title={p.peerId}
                  >
                    <span className="game-avatar-label">
                      {p.peerId}{id === "local" ? " (you)" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>Key idea:</strong>
        <pre>{`// Movement never touches React state — it's read straight from
// a ref of currently-held keys, advanced every requestAnimationFrame,
// and written directly to the DOM via el.style.transform.
// Only the *set* of players (who joined/left) goes through React state.

if (now - lastBroadcast >= 1000 / 20) {   // throttle to 20Hz
  channel.send(JSON.stringify({ x, y })); // over every open DataChannel
}`}</pre>
      </div>
    </div>
  );
}
