/**
 * ============================================================
 *  EXAMPLE: Group P2P Chat with manual "share code" signaling
 * ============================================================
 *
 *  Still zero server of any kind — no Socket.io, no PeerJS
 *  broker. But WebRTC connections are always pairwise, and
 *  manual copy-paste signaling doesn't scale to a full mesh:
 *  for n people, a full mesh needs n*(n-1)/2 pairwise code
 *  exchanges, and every existing member would need to
 *  separately exchange codes with every new joiner. Nobody's
 *  doing that by hand past 3 people.
 *
 *  Instead this uses a STAR topology: the host opens one
 *  pairwise connection per joiner (n exchanges total, all
 *  handled by the host — joiners only ever deal with ONE code
 *  exchange, with the host), and RELAYS chat messages between
 *  joiners at the application level. Joiners never connect
 *  directly to each other.
 *
 *    Alice (host)
 *      ├── DataChannel ── Bob
 *      └── DataChannel ── Carol
 *  Bob → Alice → (relayed) → Carol, and vice versa.
 *
 *  TRADE-OFF: the host is a single point of failure (if they
 *  leave, the group scatters — there's no mesh to fall back
 *  on) and every message physically passes through their
 *  browser. That's the price of not running a server: someone
 *  has to play switchboard, so it might as well be whoever
 *  started the chat.
 *
 *  Each connection still uses the same non-trickle-ICE, wait-
 *  for-gathering-complete trick as the 1:1 version — see the
 *  git history of this file, or MeshApp.jsx's comment block,
 *  for the underlying WebRTC signaling concepts.
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ICE_SERVERS } from "../lib/ice";

function waitForIceGatheringComplete(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    function check() {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    }
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// The blob is a genuine connection descriptor, not padding — once ICE
// gathering finishes, pc.localDescription has every discovered candidate
// (host, STUN-reflexive, any TURN relay) baked into the SDP as
// "a=candidate:" lines. That repetitive text compresses well, so we
// gzip it before base64 (native CompressionStream, no dependency) —
// falls back to plain base64 if the browser doesn't support it.
function bufferToBase64(buffer) {
  let binary = "";
  new Uint8Array(buffer).forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function encodeSDP(description) {
  const json = JSON.stringify(description);
  if (typeof CompressionStream === "undefined") return "0" + btoa(json);

  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  return "1" + bufferToBase64(compressed);
}

async function decodeSDP(code) {
  const trimmed = code.trim();
  const flag = trimmed[0];
  const payload = trimmed.slice(1);

  if (flag === "0" || typeof DecompressionStream === "undefined") {
    return JSON.parse(atob(payload));
  }

  const stream = new Blob([base64ToBuffer(payload)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const json = await new Response(stream).text();
  return JSON.parse(json);
}

export default function ShareCodeApp() {
  const [myName, setMyName] = useState("");
  const [role, setRole] = useState(null); // "host" | "join"

  // Join-only state (host uses `peers`/`invite` below instead)
  const [phase, setPhase] = useState("paste-offer"); // paste-offer | answer-ready | connecting | connected | closed | error
  const [myCode, setMyCode] = useState("");
  const [pastedCode, setPastedCode] = useState("");
  const [error, setError] = useState("");

  // Host-only state
  const [peers, setPeers] = useState([]); // [{ id, name, status }]
  const [invite, setInvite] = useState(null); // null | { id, step, code, pastedAnswer, error }

  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");

  const pcRef = useRef(null); // join-only: the one connection to the host
  const channelRef = useRef(null); // join-only
  const connectionsRef = useRef({}); // host-only: id -> { pc, channel }
  const myNameRef = useRef(""); // event handlers close over this instead of stale `myName`
  const bottomRef = useRef(null);

  useEffect(() => {
    myNameRef.current = myName;
  }, [myName]);

  const addMessage = useCallback((msg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function reset() {
    channelRef.current?.close();
    pcRef.current?.close();
    Object.values(connectionsRef.current).forEach(({ pc }) => pc.close());
    connectionsRef.current = {};
    pcRef.current = null;
    channelRef.current = null;
    setRole(null);
    setPhase("paste-offer");
    setMyCode("");
    setPastedCode("");
    setError("");
    setPeers([]);
    setInvite(null);
    setMessages([]);
    setMyName("");
  }

  function chooseHost() {
    if (!myName.trim()) return;
    setRole("host");
  }

  function chooseJoin() {
    if (!myName.trim()) return;
    setRole("join");
    setPhase("paste-offer");
  }

  // ── Shared: send a chat message (host broadcasts, joiner sends to host)
  function sendChat(e) {
    e.preventDefault();
    if (!message.trim()) return;
    const payload = { type: "chat", from: myName, message, timestamp: new Date().toISOString() };
    const raw = JSON.stringify(payload);

    if (role === "host") {
      let sent = 0;
      Object.values(connectionsRef.current).forEach(({ channel }) => {
        if (channel.readyState === "open") {
          channel.send(raw);
          sent++;
        }
      });
      if (sent === 0 && peers.length === 0) {
        // nobody to send to yet — still fine, just a local note
      }
    } else if (channelRef.current?.readyState === "open") {
      channelRef.current.send(raw);
    }

    addMessage({ from: "You", message, timestamp: payload.timestamp });
    setMessage("");
  }

  // ════════════════════════════════════════════════════════════
  //  HOST: one pairwise connection per joiner, relays between them
  // ════════════════════════════════════════════════════════════

  function relayToOthers(originId, rawData) {
    Object.entries(connectionsRef.current).forEach(([id, entry]) => {
      if (id !== originId && entry.channel.readyState === "open") entry.channel.send(rawData);
    });
  }

  function wireUpHostChannel(id, channel) {
    channel.onopen = () => {
      setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, status: "connected" } : p)));
      channel.send(JSON.stringify({ type: "hello", from: myNameRef.current }));
    };
    channel.onclose = () => {
      setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, status: "left" } : p)));
    };
    channel.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "hello") {
        setPeers((prev) => prev.map((p) => (p.id === id ? { ...p, name: data.from } : p)));
      } else if (data.type === "chat") {
        addMessage({ from: data.from, message: data.message, timestamp: data.timestamp });
        relayToOthers(id, event.data);
      }
    };
  }

  async function startInvite() {
    const id = `peer-${Date.now()}`;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    const channel = pc.createDataChannel("chat");
    wireUpHostChannel(id, channel);
    connectionsRef.current[id] = { pc, channel };
    setPeers((prev) => [...prev, { id, name: "…", status: "pending" }]);
    setInvite({ id, step: "generating", code: "", pastedAnswer: "", error: "" });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    setInvite({ id, step: "offer-ready", code: await encodeSDP(pc.localDescription), pastedAnswer: "", error: "" });
  }

  async function completeInvite(e) {
    e.preventDefault();
    try {
      const answer = await decodeSDP(invite.pastedAnswer);
      await connectionsRef.current[invite.id].pc.setRemoteDescription(new RTCSessionDescription(answer));
      setInvite(null); // peer flips to "connected" in the roster once its channel opens
    } catch (err) {
      console.error(err);
      setInvite((prev) => ({ ...prev, error: "That code doesn't look valid — copy the whole thing and try again." }));
    }
  }

  function cancelInvite() {
    if (invite) {
      connectionsRef.current[invite.id]?.pc.close();
      delete connectionsRef.current[invite.id];
      setPeers((prev) => prev.filter((p) => p.id !== invite.id));
    }
    setInvite(null);
  }

  // ════════════════════════════════════════════════════════════
  //  JOINER: exactly one connection, straight to the host
  // ════════════════════════════════════════════════════════════

  function wireUpJoinChannel(channel) {
    channel.onopen = () => {
      setPhase("connected");
      channel.send(JSON.stringify({ type: "hello", from: myNameRef.current }));
      addMessage({
        system: true,
        message: "✅ Connected to host — no server involved at any point",
        timestamp: new Date().toISOString(),
      });
    };
    channel.onclose = () => {
      setPhase("closed");
      addMessage({ system: true, message: "❌ Host disconnected", timestamp: new Date().toISOString() });
    };
    channel.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chat") addMessage({ from: data.from, message: data.message, timestamp: data.timestamp });
    };
  }

  async function completeJoin(e) {
    e.preventDefault();
    setError("");
    try {
      const offer = await decodeSDP(pastedCode);
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      pc.ondatachannel = (event) => {
        channelRef.current = event.channel;
        wireUpJoinChannel(event.channel);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);

      setMyCode(await encodeSDP(pc.localDescription));
      setPhase("answer-ready");
    } catch (err) {
      console.error(err);
      setError("That code doesn't look valid — copy the whole thing and try again.");
    }
  }

  function copyCode(code) {
    navigator.clipboard?.writeText(code);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>🔗 P2P Group Chat (Share Code — No Server)</h2>
        <p>
          Still zero server of ours — the host relays messages between
          joiners at the application level, over pairwise DataChannels each
          opened with a copy-pasted code. See the file's top comment for why.
        </p>
        <span className={`badge ${role === "host" ? "connected" : phase === "connected" ? "connected" : phase === "closed" || phase === "error" ? "disconnected" : "info"}`}>
          {role === "host" ? "hosting" : role === null ? "idle" : phase}
        </span>
      </div>

      {role === null && (
        <div className="join-form" style={{ maxWidth: 460 }}>
          <h3>Your name</h3>
          <input placeholder="e.g. alice" value={myName} onChange={(e) => setMyName(e.target.value)} />
          <button type="button" onClick={chooseHost} disabled={!myName.trim()}>
            Start a Group Chat (be the host)
          </button>
          <div style={{ textAlign: "center", color: "#6e7681", fontSize: "0.8rem" }}>— or —</div>
          <button type="button" onClick={chooseJoin} disabled={!myName.trim()}>
            Join a Chat (paste a code you received)
          </button>
        </div>
      )}

      {/* ── HOST VIEW ─────────────────────────────────────────── */}
      {role === "host" && (
        <div className="chat-layout">
          <aside className="user-list">
            <h4>Peers ({peers.filter((p) => p.status === "connected").length})</h4>
            {peers.length === 0 && <p className="hint">No peers yet — invite someone!</p>}
            {peers.map((p) => (
              <div key={p.id} className="user-item">
                <div>{p.status === "connected" ? "🟢" : p.status === "left" ? "⚪" : "🟡"} {p.name}</div>
                <div className="peer-status">{p.status}</div>
              </div>
            ))}

            {!invite && (
              <button type="button" className="btn-small" style={{ marginTop: "1rem" }} onClick={startInvite}>
                + Invite a Peer
              </button>
            )}

            {invite && invite.step === "generating" && <p className="hint" style={{ marginTop: "1rem" }}>Generating code…</p>}

            {invite && invite.step === "offer-ready" && (
              <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div className="hint">Send this code to your next peer:</div>
                <textarea className="share-code-box" readOnly value={invite.code} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn-small" onClick={() => copyCode(invite.code)}>Copy</button>

                <div className="hint" style={{ marginTop: "0.5rem" }}>Paste the code they send back:</div>
                <form onSubmit={completeInvite} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <textarea
                    className="share-code-box"
                    placeholder="Paste their answer code here…"
                    value={invite.pastedAnswer}
                    onChange={(e) => setInvite((prev) => ({ ...prev, pastedAnswer: e.target.value }))}
                  />
                  <button type="submit">Connect</button>
                </form>
                {invite.error && <div className="error">{invite.error}</div>}
                <button type="button" className="btn-small" onClick={cancelInvite}>Cancel</button>
              </div>
            )}

            <div className="hint" style={{ marginTop: "1rem" }}>You: <strong>{myName}</strong> (host)</div>
          </aside>

          <div className="chat-panel">
            <div className="messages">
              {messages.map((msg, i) =>
                msg.system ? (
                  <div key={i} className="msg system">{msg.message}</div>
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
            <form className="message-form" onSubmit={sendChat}>
              <input
                placeholder="Message the group (P2P — relayed by you, no server)…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button type="submit">Send P2P</button>
            </form>
          </div>
        </div>
      )}

      {/* ── JOINER VIEW ───────────────────────────────────────── */}
      {role === "join" && phase === "paste-offer" && (
        <div className="join-form" style={{ maxWidth: 560 }}>
          <h3>Paste the code your friend sent you</h3>
          <form onSubmit={completeJoin} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <textarea
              className="share-code-box"
              placeholder="Paste their offer code here…"
              value={pastedCode}
              onChange={(e) => setPastedCode(e.target.value)}
            />
            <button type="submit">Generate My Code</button>
          </form>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {role === "join" && (phase === "answer-ready" || phase === "connecting") && (
        <div className="join-form" style={{ maxWidth: 560 }}>
          <h3>Send this code back to your friend</h3>
          <textarea className="share-code-box" readOnly value={myCode} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn-small" onClick={() => copyCode(myCode)}>Copy Code</button>
          <p className="hint">Once they paste it in, the connection completes automatically — nothing more to do here.</p>
        </div>
      )}

      {role === "join" && phase === "closed" && <div className="error">The host disconnected.</div>}

      {role === "join" && phase === "connected" && (
        <div className="chat-panel" style={{ flex: 1 }}>
          <div className="messages">
            {messages.map((msg, i) =>
              msg.system ? (
                <div key={i} className="msg system">{msg.message}</div>
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
          <form className="message-form" onSubmit={sendChat}>
            <input
              placeholder="Message the group (P2P — relayed by the host, no server)…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button type="submit">Send P2P</button>
          </form>
        </div>
      )}

      {role !== null && (
        <button type="button" className="btn-small" style={{ alignSelf: "flex-start" }} onClick={reset}>
          Start Over
        </button>
      )}

      <div className="code-note">
        <strong>Key idea:</strong>
        <pre>{`// Host relays by simply forwarding the raw message to every OTHER
// open channel — the original "from" field travels along untouched,
// so joiners see proper multi-party attribution even though they're
// only ever directly connected to the host.

channel.onmessage = (event) => {
  const data = JSON.parse(event.data);
  addMessage(data);
  relayToOthers(originId, event.data); // forward verbatim
};`}</pre>
      </div>
    </div>
  );
}
