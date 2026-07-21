/**
 * ============================================================
 *  NAMESPACE: /broadcast  —  Server → All Clients Push
 * ============================================================
 *
 *  CONCEPTS DEMONSTRATED
 *  ─────────────────────
 *  • io.emit()           — emit to EVERY connected socket
 *  • setInterval         — server pushes data on a schedule
 *  • socket.broadcast.emit() — emit to everyone EXCEPT sender
 *  • Acknowledgements    — client confirms receipt with a callback
 *
 *  This is useful for things like:
 *    - Live score tickers
 *    - Stock / crypto price feeds
 *    - Server health dashboards
 *    - Breaking news banners
 *
 *  CLIENT EVENTS (sent from client → server)
 *  ──────────────────────────────────────────
 *  subscribe_ticker    — start receiving ticker updates
 *  unsubscribe_ticker  — stop receiving ticker updates
 *  send_announcement { message, author } — broadcast to everyone
 *
 *  SERVER EVENTS (emitted from server → client)
 *  ─────────────────────────────────────────────
 *  ticker_update  { value, currency, timestamp }
 *  announcement   { message, author, timestamp }
 *  connected_count { count }
 * ============================================================
 */

function registerBroadcast(io) {
  const broadcast = io.of("/broadcast");

  // Fake price ticker — simulates a live data feed
  let tickerInterval = null;
  let subscriberCount = 0;

  function startTicker() {
    if (tickerInterval) return; // already running
    tickerInterval = setInterval(() => {
      // Only push if someone is subscribed
      if (subscriberCount === 0) return;

      const price = (Math.random() * 10000 + 20000).toFixed(2);
      broadcast.emit("ticker_update", {
        value: price,
        currency: "BTC/USD",
        timestamp: new Date().toISOString(),
      });
    }, 2000);
  }

  function stopTicker() {
    if (tickerInterval) {
      clearInterval(tickerInterval);
      tickerInterval = null;
    }
  }

  broadcast.on("connection", (socket) => {
    console.log(`[/broadcast] socket connected: ${socket.id}`);

    // Push total connection count to everyone when someone joins
    const count = broadcast.sockets.size;
    broadcast.emit("connected_count", { count });

    // ── subscribe_ticker ─────────────────────────────────────
    socket.on("subscribe_ticker", () => {
      subscriberCount++;
      startTicker();
      console.log(`[/broadcast] ${socket.id} subscribed to ticker`);
    });

    // ── unsubscribe_ticker ───────────────────────────────────
    socket.on("unsubscribe_ticker", () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) stopTicker();
    });

    // ── send_announcement ────────────────────────────────────
    // One user sends an announcement; server blasts it to ALL clients.
    // Uses an acknowledgement callback so the sender gets confirmation.
    socket.on("send_announcement", ({ message, author }, ack) => {
      const payload = {
        message,
        author,
        timestamp: new Date().toISOString(),
      };

      // io.of("/broadcast").emit sends to EVERY socket in namespace
      broadcast.emit("announcement", payload);

      // The optional `ack` callback lets the client know it was received
      if (typeof ack === "function") {
        ack({ success: true, timestamp: payload.timestamp });
      }
    });

    // ── disconnect ───────────────────────────────────────────
    socket.on("disconnect", () => {
      const newCount = broadcast.sockets.size;
      broadcast.emit("connected_count", { count: newCount });
      console.log(`[/broadcast] socket disconnected: ${socket.id}`);
    });
  });
}

module.exports = { registerBroadcast };
