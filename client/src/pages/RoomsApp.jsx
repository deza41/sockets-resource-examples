/**
 * ============================================================
 *  EXAMPLE: Room Management + Typing Indicators + Read Receipts
 * ============================================================
 *
 *  What this teaches:
 *  ──────────────────
 *  1. Creating and listing rooms dynamically
 *  2. Typing indicators — ephemeral events with debounce
 *  3. Read receipts — ack that a message was seen
 *  4. socket.rooms — knowing which rooms you're in
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { roomsSocket } from "../lib/sockets";

// A stable debounce hook — the returned function never changes identity
// so it won't cause infinite re-render loops when used as a dependency.
function useDebounce(fn, delay) {
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; }, [fn]);
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fnRef.current(...args), delay);
  }, [delay]); // delay is stable, so this callback is created only once
}

export default function RoomsApp() {
  const [username, setUsername] = useState("");
  const [joined, setJoined] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [newRoom, setNewRoom] = useState("");
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState({});   // roomName → [msgs]
  const [typingUsers, setTypingUsers] = useState({}); // roomName → [names]
  const [receipts, setReceipts] = useState({});   // messageId → [readBy]
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("disconnected");
  const bottomRef = useRef(null);
  const msgIdCounter = useRef(0);

  // Keep refs for values needed inside socket callbacks
  const activeRoomRef = useRef(activeRoom);
  const usernameRef = useRef(username);
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { usernameRef.current = username; }, [username]);

  useEffect(() => {
    // Connect once — do NOT disconnect on unmount so that room state
    // survives navigating away and back to this page.
    if (!roomsSocket.connected) roomsSocket.connect();

    roomsSocket.on("connect", () => setStatus("connected"));
    roomsSocket.on("disconnect", () => {
      setStatus("disconnected");
      setJoined(false);
    });

    // room_created fires for everyone (including the creator).
    // The server also tells the creator to "join" via room_joined_self.
    roomsSocket.on("room_created", ({ roomName }) => {
      setRooms((prev) => [...new Set([...prev, roomName])]);
    });

    // Sent back only to the creator so they auto-enter the room they made
    roomsSocket.on("room_joined_self", ({ roomName }) => {
      setActiveRoom(roomName);
    });

    roomsSocket.on("room_list", ({ rooms: r }) => setRooms(r));

    roomsSocket.on("user_joined", ({ username: u, roomName }) => {
      addSystemMsg(roomName, `${u} joined`);
    });

    roomsSocket.on("user_left", ({ username: u, roomName }) => {
      addSystemMsg(roomName, `${u} left`);
    });

    roomsSocket.on("new_message", (msg) => {
      setMessages((prev) => ({
        ...prev,
        [msg.roomName]: [...(prev[msg.roomName] || []), msg],
      }));
    });

    roomsSocket.on("typing", ({ username: u, roomName, isTyping }) => {
      setTypingUsers((prev) => {
        const current = prev[roomName] || [];
        if (isTyping) return { ...prev, [roomName]: [...new Set([...current, u])] };
        return { ...prev, [roomName]: current.filter((n) => n !== u) };
      });
    });

    roomsSocket.on("receipt", ({ messageId, readBy }) => {
      setReceipts((prev) => ({
        ...prev,
        [messageId]: [...new Set([...(prev[messageId] || []), readBy])],
      }));
    });

    // Only remove listeners on unmount — keep the socket connected
    // so room membership and state survive page navigation.
    return () => {
      roomsSocket.off("connect");
      roomsSocket.off("disconnect");
      roomsSocket.off("room_created");
      roomsSocket.off("room_joined_self");
      roomsSocket.off("room_list");
      roomsSocket.off("user_joined");
      roomsSocket.off("user_left");
      roomsSocket.off("new_message");
      roomsSocket.off("typing");
      roomsSocket.off("receipt");
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeRoom]);

  function addSystemMsg(roomName, text) {
    setMessages((prev) => ({
      ...prev,
      [roomName]: [
        ...(prev[roomName] || []),
        { system: true, message: text, timestamp: new Date().toISOString() },
      ],
    }));
  }

  function handleStart(e) {
    e.preventDefault();
    if (!username.trim()) return;
    roomsSocket.emit("set_username", { username });
    roomsSocket.emit("list_rooms");
    setJoined(true);
  }

  function handleCreateRoom(e) {
    e.preventDefault();
    if (!newRoom.trim()) return;
    // Server will emit room_created (to all) + room_joined_self (to creator)
    roomsSocket.emit("create_room", { roomName: newRoom });
    setNewRoom("");
  }

  function switchRoom(roomName) {
    if (activeRoom) roomsSocket.emit("leave_room", { roomName: activeRoom });
    roomsSocket.emit("join_room", { roomName });
    setActiveRoom(roomName);
  }

  // Debounce the "stop typing" signal
  const stopTyping = useDebounce(() => {
    if (activeRoom) roomsSocket.emit("typing_stop", { roomName: activeRoom });
  }, 1000);

  function handleMessageChange(e) {
    setMessage(e.target.value);
    if (activeRoom) {
      roomsSocket.emit("typing_start", { roomName: activeRoom });
      stopTyping();
    }
  }

  function handleSend(e) {
    e.preventDefault();
    if (!message.trim() || !activeRoom) return;
    // Use roomsSocket.id (the actual socket ID) — not an undefined `socket` var
    const messageId = `${roomsSocket.id ?? "local"}-${++msgIdCounter.current}`;
    roomsSocket.emit("send_message", { roomName: activeRoom, message, messageId });
    roomsSocket.emit("typing_stop", { roomName: activeRoom });
    setMessage("");
  }

  function handleReadReceipt(messageId) {
    if (!activeRoom) return;
    roomsSocket.emit("read_receipt", { messageId, roomName: activeRoom });
  }

  const activeMessages = messages[activeRoom] || [];
  const activeTyping = (typingUsers[activeRoom] || []).filter(
    (u) => u !== username
  );

  return (
    <div className="page">
      <div className="page-header">
        <h2>🚪 Rooms + Typing + Receipts</h2>
        <p>Full Slack-like room lifecycle. Open two tabs to see typing indicators!</p>
        <span className={`badge ${status}`}>{status}</span>
      </div>

      {!joined ? (
        <form className="join-form" onSubmit={handleStart}>
          <h3>Enter a Display Name</h3>
          <input
            placeholder="Your username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button type="submit">Start</button>
        </form>
      ) : (
        <div className="chat-layout">
          {/* Rooms sidebar */}
          <aside className="user-list">
            <h4>Rooms</h4>
            {rooms.map((r) => (
              <div
                key={r}
                className={`user-item clickable ${activeRoom === r ? "selected" : ""}`}
                onClick={() => switchRoom(r)}
              >
                # {r}
              </div>
            ))}
            <form
              onSubmit={handleCreateRoom}
              style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}
            >
              <input
                placeholder="New room name…"
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                style={{ fontSize: "0.8rem", padding: "0.3rem" }}
              />
              <button type="submit" className="btn-small">
                + Create Room
              </button>
            </form>
          </aside>

          {/* Chat panel */}
          <div className="chat-panel">
            {activeRoom ? (
              <>
                <div className="chat-header"># {activeRoom}</div>
                <div className="messages">
                  {activeMessages.map((msg, i) =>
                    msg.system ? (
                      <div key={i} className="msg system">
                        {msg.message}
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={`msg ${msg.username === username ? "mine" : "theirs"}`}
                        onClick={() => msg.messageId && handleReadReceipt(msg.messageId)}
                        title="Click to send read receipt"
                      >
                        <span className="msg-author">{msg.username}</span>
                        <span className="msg-text">{msg.message}</span>
                        <span className="msg-time">
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                        {msg.messageId && receipts[msg.messageId]?.length > 0 && (
                          <span className="receipt">
                            ✓✓ Read by {receipts[msg.messageId].join(", ")}
                          </span>
                        )}
                      </div>
                    )
                  )}
                  <div ref={bottomRef} />
                </div>

                {activeTyping.length > 0 && (
                  <div className="typing-indicator">
                    {activeTyping.join(", ")}{" "}
                    {activeTyping.length === 1 ? "is" : "are"} typing…
                  </div>
                )}

                <form className="message-form" onSubmit={handleSend}>
                  <input
                    placeholder={`Message #${activeRoom}…`}
                    value={message}
                    onChange={handleMessageChange}
                  />
                  <button type="submit">Send</button>
                </form>
              </>
            ) : (
              <div className="empty-state">
                Select or create a room to get started
              </div>
            )}
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>Key code pattern (typing indicator):</strong>
        <pre>{`// Client: emit on keydown, debounce the stop
socket.emit("typing_start", { roomName });
// ...after 1s of inactivity:
socket.emit("typing_stop", { roomName });

// Server: relay to room (exclude sender)
socket.on("typing_start", ({ roomName }) => {
  socket.to(roomName).emit("typing", { username, isTyping: true });
});`}</pre>
      </div>
    </div>
  );
}
