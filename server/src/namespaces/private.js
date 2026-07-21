/**
 * ============================================================
 *  NAMESPACE: /private  —  Direct Messaging Between Users
 * ============================================================
 *
 *  CONCEPTS DEMONSTRATED
 *  ─────────────────────
 *  • socket.id           — unique ID per connection, used as
 *                          an address to target a single socket
 *  • io.to(socketId)     — emit to exactly one socket
 *  • User registry map   — map username → socket.id so clients
 *                          don't need to know socket IDs
 *
 *  CLIENT EVENTS (sent from client → server)
 *  ──────────────────────────────────────────
 *  register   { username }        — register a display name
 *  dm         { to, message }     — send a DM to `to` username
 *
 *  SERVER EVENTS (emitted from server → client)
 *  ─────────────────────────────────────────────
 *  registered      { socketId, username }
 *  dm_received     { from, message, timestamp }
 *  dm_error        { error }
 *  online_users    { users: string[] }
 * ============================================================
 */

// username → socket.id
const userRegistry = new Map();

function registerPrivateMessages(io) {
  const dm = io.of("/private");

  dm.on("connection", (socket) => {
    console.log(`[/private] socket connected: ${socket.id}`);

    // ── register ─────────────────────────────────────────────
    // Each client picks a username.  We store username → socket.id
    // so other users can address them by name (not raw socket ID).
    socket.on("register", ({ username }) => {
      userRegistry.set(username, socket.id);
      socket.data.username = username;

      // Confirm registration back to the registering socket
      socket.emit("registered", { socketId: socket.id, username });

      // Broadcast updated online list to everyone
      dm.emit("online_users", { users: Array.from(userRegistry.keys()) });

      console.log(`[/private] registered: ${username} → ${socket.id}`);
    });

    // ── dm ───────────────────────────────────────────────────
    // Client sends { to: "alice", message: "Hello!" }
    // Server looks up Alice's socket ID and forwards the message.
    socket.on("dm", ({ to, message }) => {
      const targetSocketId = userRegistry.get(to);

      if (!targetSocketId) {
        // User not found — send error back only to the sender
        socket.emit("dm_error", { error: `User "${to}" is not online.` });
        return;
      }

      const payload = {
        from: socket.data.username,
        message,
        timestamp: new Date().toISOString(),
      };

      // Target the specific socket by its ID
      dm.to(targetSocketId).emit("dm_received", payload);

      // Also echo back to sender so they see their own sent message
      socket.emit("dm_received", { ...payload, from: "You" });
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      const { username } = socket.data;
      if (username) {
        userRegistry.delete(username);
        dm.emit("online_users", { users: Array.from(userRegistry.keys()) });
      }
      console.log(`[/private] socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerPrivateMessages };
