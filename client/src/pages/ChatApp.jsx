/**
 * ============================================================
 *  EXAMPLE: Multi-Room Chat App
 * ============================================================
 *
 *  What this teaches:
 *  ──────────────────
 *  1. Connecting to a Socket.io namespace (/chat)
 *  2. Emitting "join_room" so the server adds this socket to a room
 *  3. Listening for "receive_message" to display incoming messages
 *  4. Listening for "user_joined" / "user_left" for presence updates
 *  5. Disconnecting cleanly when the component unmounts
 * ============================================================
 */

import React, { useState, useEffect, useRef } from "react";
import { chatSocket } from "../lib/sockets";

export default function ChatApp() {
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("general");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const bottomRef = useRef(null);

  // ── STEP 1: Connect on mount, disconnect on unmount ────────
  useEffect(() => {
    // Connect if not already connected (singleton — safe to call repeatedly)
    if (!chatSocket.connected) chatSocket.connect();

    // Track connection state
    chatSocket.on("connect", () => setStatus("connected"));
    chatSocket.on("disconnect", () => {
      setStatus("disconnected");
      setJoined(false);
    });

    // ── STEP 3: Listen for incoming messages ─────────────────
    chatSocket.on("receive_message", (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    // ── STEP 4: Listen for user presence events ───────────────
    chatSocket.on("user_joined", ({ username: u, room: r }) => {
      setMessages((prev) => [
        ...prev,
        { system: true, message: `${u} joined ${r}`, timestamp: new Date().toISOString() },
      ]);
    });

    chatSocket.on("user_left", ({ username: u, room: r }) => {
      setMessages((prev) => [
        ...prev,
        { system: true, message: `${u} left ${r}`, timestamp: new Date().toISOString() },
      ]);
    });

    chatSocket.on("room_users", ({ users: u }) => setUsers(u));

    // ── STEP 5: Cleanup when component unmounts ───────────────
    // Only remove listeners — do NOT disconnect the socket.
    // Disconnecting would drop us from the room and wipe all
    // server-side state every time the user navigates away.
    return () => {
      chatSocket.off("connect");
      chatSocket.off("disconnect");
      chatSocket.off("receive_message");
      chatSocket.off("user_joined");
      chatSocket.off("user_left");
      chatSocket.off("room_users");
    };
  }, []);

  // Auto-scroll to newest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── STEP 2: Join a room ────────────────────────────────────
  function handleJoin(e) {
    e.preventDefault();
    if (!username.trim() || !room.trim()) return;

    // Emit "join_room" — the server calls socket.join(room) for us
    chatSocket.emit("join_room", { room, username });
    setJoined(true);
    setMessages([]);
  }

  function handleSend(e) {
    e.preventDefault();
    if (!message.trim()) return;

    // Emit to server; server will broadcast to everyone in the room
    chatSocket.emit("send_message", { room, username, message });
    setMessage("");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>💬 Chat App</h2>
        <p>
          Multi-room chat. Open multiple tabs to see messages appear in
          real-time!
        </p>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      {!joined ? (
        <form className="join-form" onSubmit={handleJoin}>
          <h3>Join a Room</h3>
          <input
            placeholder="Your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            placeholder="Room name (e.g. general)"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <button type="submit">Join Room</button>
        </form>
      ) : (
        <div className="chat-layout">
          {/* Sidebar: user list */}
          <aside className="user-list">
            <h4>Online in #{room}</h4>
            {users.map((u) => (
              <div key={u} className={`user-item ${u === username ? "me" : ""}`}>
                🟢 {u} {u === username ? "(you)" : ""}
              </div>
            ))}
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
                    className={`msg ${msg.username === username ? "mine" : "theirs"}`}
                  >
                    <span className="msg-author">{msg.username}</span>
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
                placeholder="Type a message…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>Key code pattern:</strong>
        <pre>{`// Client
chatSocket.emit("join_room", { room, username });
chatSocket.on("receive_message", (msg) => { ... });

// Server
socket.join(room);               // add to room
io.to(room).emit("receive_message", payload); // broadcast`}</pre>
      </div>
    </div>
  );
}
