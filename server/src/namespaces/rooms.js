/**
 * ============================================================
 *  NAMESPACE: /rooms  —  Room Management & Presence
 * ============================================================
 *
 *  CONCEPTS DEMONSTRATED
 *  ─────────────────────
 *  • Dynamic room creation / listing
 *  • socket.rooms             — all rooms a socket is in
 *  • io.of(ns).adapter.rooms  — all active rooms server-side
 *  • "Typing" indicators      — ephemeral real-time events
 *  • Read receipts            — ack pattern for delivery confirmation
 *
 *  CLIENT EVENTS (sent from client → server)
 *  ──────────────────────────────────────────
 *  set_username   { username }
 *  create_room    { roomName }
 *  join_room      { roomName }
 *  leave_room     { roomName }
 *  list_rooms     — no payload
 *  typing_start   { roomName }
 *  typing_stop    { roomName }
 *  send_message   { roomName, message, messageId }
 *  read_receipt   { messageId, roomName }
 *
 *  SERVER EVENTS (emitted from server → client)
 *  ─────────────────────────────────────────────
 *  room_created   { roomName, createdBy }
 *  room_list      { rooms: string[] }
 *  user_joined    { username, roomName }
 *  user_left      { username, roomName }
 *  typing         { username, roomName, isTyping }
 *  new_message    { username, message, messageId, roomName, timestamp }
 *  receipt        { messageId, readBy, timestamp }
 * ============================================================
 */

function registerRooms(io) {
  const rooms = io.of("/rooms");

  rooms.on("connection", (socket) => {
    console.log(`[/rooms] socket connected: ${socket.id}`);

    // ── set_username ─────────────────────────────────────────
    socket.on("set_username", ({ username }) => {
      socket.data.username = username;
    });

    // ── create_room ──────────────────────────────────────────
    socket.on("create_room", ({ roomName }) => {
      socket.join(roomName);

      // Notify everyone (including creator) that a new room exists
      rooms.emit("room_created", {
        roomName,
        createdBy: socket.data.username || socket.id,
      });

      // Tell the creator specifically to auto-enter the room they just made.
      // Without this the creator's activeRoom state stays null and they
      // can't type even though they are subscribed to the room server-side.
      socket.emit("room_joined_self", { roomName });
    });

    // ── join_room ────────────────────────────────────────────
    socket.on("join_room", ({ roomName }) => {
      socket.join(roomName);
      socket.to(roomName).emit("user_joined", {
        username: socket.data.username,
        roomName,
      });
    });

    // ── leave_room ───────────────────────────────────────────
    socket.on("leave_room", ({ roomName }) => {
      socket.leave(roomName);
      rooms.to(roomName).emit("user_left", {
        username: socket.data.username,
        roomName,
      });
    });

    // ── list_rooms ───────────────────────────────────────────
    // Walk the adapter's internal room map, filtering out the
    // per-socket private rooms (those equal a socket.id).
    socket.on("list_rooms", () => {
      const allRooms = [];
      for (const [roomName] of rooms.adapter.rooms) {
        if (!rooms.sockets.has(roomName)) {
          // It's a "real" room, not the private socket room
          allRooms.push(roomName);
        }
      }
      socket.emit("room_list", { rooms: allRooms });
    });

    // ── typing indicators ─────────────────────────────────────
    // These are fire-and-forget ephemeral events — no storage needed.
    socket.on("typing_start", ({ roomName }) => {
      socket.to(roomName).emit("typing", {
        username: socket.data.username,
        roomName,
        isTyping: true,
      });
    });

    socket.on("typing_stop", ({ roomName }) => {
      socket.to(roomName).emit("typing", {
        username: socket.data.username,
        roomName,
        isTyping: false,
      });
    });

    // ── send_message ─────────────────────────────────────────
    socket.on("send_message", ({ roomName, message, messageId }) => {
      rooms.to(roomName).emit("new_message", {
        username: socket.data.username,
        message,
        messageId,
        roomName,
        timestamp: new Date().toISOString(),
      });
    });

    // ── read_receipt ──────────────────────────────────────────
    // Client acknowledges it has read a message.  Broadcast to room.
    socket.on("read_receipt", ({ messageId, roomName }) => {
      rooms.to(roomName).emit("receipt", {
        messageId,
        readBy: socket.data.username,
        timestamp: new Date().toISOString(),
      });
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[/rooms] socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerRooms };
