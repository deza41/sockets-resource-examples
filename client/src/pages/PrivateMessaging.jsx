/**
 * ============================================================
 *  EXAMPLE: Private Messaging (DMs)
 * ============================================================
 *
 *  What this teaches:
 *  ──────────────────
 *  1. Registering a username → server maps it to a socket ID
 *  2. Sending a DM: client says "to: alice", server looks up
 *     Alice's socket ID and calls io.to(socketId).emit(...)
 *  3. Maintaining an online users list
 *  4. Handling errors (user not found)
 * ============================================================
 */

import React, { useState, useEffect, useRef } from "react";
import { privateSocket } from "../lib/sockets";

export default function PrivateMessaging() {
  const [username, setUsername] = useState("");
  const [registered, setRegistered] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [conversations, setConversations] = useState({}); // { username: [msgs] }
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("disconnected");
  const bottomRef = useRef(null);
  // Keep a ref to selectedUser so the dm_received handler always reads
  // the latest value without needing to be re-registered on every click.
  const selectedUserRef = useRef(selectedUser);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

  useEffect(() => {
    if (!privateSocket.connected) privateSocket.connect();
    privateSocket.on("connect", () => setStatus("connected"));
    privateSocket.on("disconnect", () => {
      setStatus("disconnected");
      setRegistered(false);
    });

    // After server confirms registration
    privateSocket.on("registered", ({ socketId }) => {
      console.log("Registered with socket ID:", socketId);
    });

    // Updated online user list broadcast by server
    privateSocket.on("online_users", ({ users }) => {
      setOnlineUsers(users);
    });

    // Incoming DM — use the ref so we always have the current selectedUser
    // without tearing down and re-registering this listener on every click.
    privateSocket.on("dm_received", ({ from, message: msg, timestamp }) => {
      setConversations((prev) => {
        const key = from === "You" ? selectedUserRef.current : from;
        return {
          ...prev,
          [key]: [...(prev[key] || []), { from, message: msg, timestamp }],
        };
      });
    });

    // Error from server (e.g. user not online)
    privateSocket.on("dm_error", ({ error: err }) => {
      setError(err);
      setTimeout(() => setError(""), 3000);
    });

    // Remove listeners only — keep socket alive so the username
    // registration and online-user list survive page navigation.
    return () => {
      privateSocket.off("connect");
      privateSocket.off("disconnect");
      privateSocket.off("registered");
      privateSocket.off("online_users");
      privateSocket.off("dm_received");
      privateSocket.off("dm_error");
    };
  }, []); // empty deps — register listeners once, use refs for mutable values

  function handleRegister(e) {
    e.preventDefault();
    if (!username.trim()) return;
    privateSocket.emit("register", { username });
    setRegistered(true);
  }

  function handleSend(e) {
    e.preventDefault();
    if (!message.trim() || !selectedUser) return;

    // Client just says "to: alice" — server handles the routing
    privateSocket.emit("dm", { to: selectedUser, message });
    setMessage("");
  }

  const currentConvo = conversations[selectedUser] || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentConvo]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>🔒 Private Messaging</h2>
        <p>
          Direct messages routed via socket ID. Open two tabs with different
          usernames to DM each other!
        </p>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      {!registered ? (
        <form className="join-form" onSubmit={handleRegister}>
          <h3>Register a Username</h3>
          <input
            placeholder="Choose a username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit">Register</button>
        </form>
      ) : (
        <div className="chat-layout">
          {/* Online users sidebar */}
          <aside className="user-list">
            <h4>Online Users</h4>
            {onlineUsers
              .filter((u) => u !== username)
              .map((u) => (
                <div
                  key={u}
                  className={`user-item clickable ${selectedUser === u ? "selected" : ""}`}
                  onClick={() => setSelectedUser(u)}
                >
                  🟢 {u}
                  {conversations[u]?.length > 0 && (
                    <span className="msg-badge">{conversations[u].length}</span>
                  )}
                </div>
              ))}
            {onlineUsers.filter((u) => u !== username).length === 0 && (
              <p className="hint">No other users online yet.</p>
            )}
          </aside>

          {/* DM panel */}
          <div className="chat-panel">
            {selectedUser ? (
              <>
                <div className="chat-header">
                  DM with <strong>{selectedUser}</strong>
                </div>
                <div className="messages">
                  {currentConvo.map((msg, i) => (
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
                  ))}
                  <div ref={bottomRef} />
                </div>
                {error && <p className="error">{error}</p>}
                <form className="message-form" onSubmit={handleSend}>
                  <input
                    placeholder={`Message ${selectedUser}…`}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button type="submit">Send</button>
                </form>
              </>
            ) : (
              <div className="empty-state">
                Select a user to start a conversation
              </div>
            )}
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>Key code pattern:</strong>
        <pre>{`// Server: target a specific socket by ID
const targetSocketId = userRegistry.get(toUsername);
io.to(targetSocketId).emit("dm_received", payload);

// Client: just use the username
socket.emit("dm", { to: "alice", message: "Hello!" });`}</pre>
      </div>
    </div>
  );
}
