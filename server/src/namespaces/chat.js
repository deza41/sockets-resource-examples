/**
 * ============================================================
 *  NAMESPACE: /chat  —  Multi-Room Chat
 * ============================================================
 *
 *  CONCEPTS DEMONSTRATED
 *  ─────────────────────
 *  • socket.join(room)   — subscribe this socket to a room
 *  • socket.to(room)     — emit to everyone in room EXCEPT sender
 *  • io.to(room)         — emit to EVERYONE in room (incl. sender)
 *  • socket.rooms        — Set of rooms this socket is currently in
 *  • socket.on("disconnect") — cleanup when a user leaves
 *
 *  CLIENT EVENTS (sent from client → server)
 *  ──────────────────────────────────────────
 *  join_room    { room, username }
 *  leave_room   { room, username }
 *  send_message { room, username, message }
 *
 *  SERVER EVENTS (emitted from server → client)
 *  ─────────────────────────────────────────────
 *  user_joined  { username, room, timestamp }
 *  user_left    { username, room, timestamp }
 *  receive_message { username, message, room, timestamp }
 *  room_users   { room, users: string[] }
 * ============================================================
 */

// In-memory store: room → Set of usernames
// In a production app you'd use Redis or a database here.
const roomUsers = {};

function registerChat(io) {
  // Create a dedicated namespace.  Clients connect with:
  //   const socket = io("http://localhost:3001/chat");
  const chat = io.of("/chat");

  chat.on("connection", (socket) => {
    console.log(`[/chat] socket connected: ${socket.id}`);

    // ── join_room ────────────────────────────────────────────
    // The client wants to enter a named chat room.
    socket.on("join_room", ({ room, username }) => {
      // Subscribe this socket to the Socket.io "room" so it
      // receives messages broadcast to that room.
      socket.join(room);

      // Track user in our in-memory map
      if (!roomUsers[room]) roomUsers[room] = new Set();
      roomUsers[room].add(username);

      // Store on the socket itself so we can clean up on disconnect
      socket.data.username = username;
      socket.data.room = room;

      // Tell everyone else in the room that someone joined
      socket.to(room).emit("user_joined", {
        username,
        room,
        timestamp: new Date().toISOString(),
      });

      // Send the updated user list to EVERYONE in the room
      // (existing users need to see the new joiner in their sidebar too)
      chat.to(room).emit("room_users", {
        room,
        users: Array.from(roomUsers[room]),
      });

      console.log(`[/chat] ${username} joined room: ${room}`);
    });

    // ── leave_room ───────────────────────────────────────────
    socket.on("leave_room", ({ room, username }) => {
      socket.leave(room);
      roomUsers[room]?.delete(username);

      // Notify remaining members
      chat.to(room).emit("user_left", {
        username,
        room,
        timestamp: new Date().toISOString(),
      });

      // Broadcast updated user list
      chat.to(room).emit("room_users", {
        room,
        users: Array.from(roomUsers[room] ?? []),
      });
    });

    // ── send_message ─────────────────────────────────────────
    // Relay a message to everyone in the room INCLUDING the sender
    // (so the sender sees their own message reflected back).
    socket.on("send_message", ({ room, username, message }) => {
      chat.to(room).emit("receive_message", {
        username,
        message,
        room,
        timestamp: new Date().toISOString(),
      });
    });

    // ── disconnect ───────────────────────────────────────────
    // Socket.io fires this automatically when the TCP connection drops.
    socket.on("disconnect", () => {
      const { username, room } = socket.data;
      if (username && room) {
        roomUsers[room]?.delete(username);
        chat.to(room).emit("user_left", {
          username,
          room,
          timestamp: new Date().toISOString(),
        });
      }
      console.log(`[/chat] socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerChat };
