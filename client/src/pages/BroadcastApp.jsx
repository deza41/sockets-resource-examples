/**
 * ============================================================
 *  EXAMPLE: Server Broadcast / Live Ticker
 * ============================================================
 *
 *  What this teaches:
 *  ──────────────────
 *  1. Server → all clients push (io.emit)
 *  2. Socket.io acknowledgements (callbacks on emit)
 *  3. subscribe/unsubscribe pattern to control server-side intervals
 *  4. Watching connection count in real time
 * ============================================================
 */

import React, { useState, useEffect, useRef } from "react";
import { broadcastSocket } from "../lib/sockets";

export default function BroadcastApp() {
  const [price, setPrice] = useState(null);
  const [priceHistory, setPriceHistory] = useState([]);
  const [announcement, setAnnouncement] = useState("");
  const [announcements, setAnnouncements] = useState([]);
  const [connectedCount, setConnectedCount] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const [ackResult, setAckResult] = useState(null);
  const [status, setStatus] = useState("disconnected");

  useEffect(() => {
    broadcastSocket.connect();

    broadcastSocket.on("connect", () => setStatus("connected"));
    broadcastSocket.on("disconnect", () => {
      setStatus("disconnected");
      setSubscribed(false);
    });

    // ── Listen for ticker updates ─────────────────────────────
    // Server pushes this every 2 seconds when subscribed
    broadcastSocket.on("ticker_update", ({ value, currency, timestamp }) => {
      setPrice({ value, currency });
      setPriceHistory((prev) => [
        { value, timestamp },
        ...prev.slice(0, 9), // keep last 10
      ]);
    });

    // ── Listen for announcements from any user ────────────────
    broadcastSocket.on("announcement", (payload) => {
      setAnnouncements((prev) => [payload, ...prev.slice(0, 19)]);
    });

    // ── Listen for total connection count ─────────────────────
    broadcastSocket.on("connected_count", ({ count }) => {
      setConnectedCount(count);
    });

    return () => {
      broadcastSocket.off("connect");
      broadcastSocket.off("disconnect");
      broadcastSocket.off("ticker_update");
      broadcastSocket.off("announcement");
      broadcastSocket.off("connected_count");
      broadcastSocket.disconnect();
    };
  }, []);

  function toggleTicker() {
    if (subscribed) {
      broadcastSocket.emit("unsubscribe_ticker");
      setSubscribed(false);
    } else {
      broadcastSocket.emit("subscribe_ticker");
      setSubscribed(true);
    }
  }

  // ── Emit with acknowledgement ─────────────────────────────
  // The third argument to emit() is a callback that the SERVER calls
  // to confirm it received the message.
  function sendAnnouncement() {
    if (!announcement.trim()) return;
    broadcastSocket.emit(
      "send_announcement",
      { message: announcement, author: "You" },
      (ack) => {
        // This callback fires when the server calls ack({ success: true })
        setAckResult(`Server confirmed at: ${ack.timestamp}`);
        setTimeout(() => setAckResult(null), 3000);
      }
    );
    setAnnouncement("");
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>📡 Broadcast / Ticker</h2>
        <p>Server pushes data to all connected clients. Open multiple tabs!</p>
        <span className={`badge ${status}`}>{status}</span>
        <span className="badge info">👥 {connectedCount} connected</span>
      </div>

      {/* Ticker */}
      <div className="card">
        <h3>Live Price Ticker</h3>
        <p className="ticker-price">
          {price ? `${price.currency}: $${price.value}` : "Not subscribed"}
        </p>
        <button onClick={toggleTicker} className={subscribed ? "btn-danger" : "btn-primary"}>
          {subscribed ? "Unsubscribe" : "Subscribe to Ticker"}
        </button>

        {priceHistory.length > 0 && (
          <div className="price-history">
            {priceHistory.map((p, i) => (
              <div key={i} className="price-row">
                <span>${p.value}</span>
                <span>{new Date(p.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Announcements */}
      <div className="card">
        <h3>Announcements (with Acknowledgement)</h3>
        <p className="hint">
          Emit sends a message; the callback fires when the server confirms
          receipt.
        </p>
        <div className="input-row">
          <input
            placeholder="Type an announcement…"
            value={announcement}
            onChange={(e) => setAnnouncement(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendAnnouncement()}
          />
          <button onClick={sendAnnouncement}>Broadcast</button>
        </div>
        {ackResult && <p className="ack-result">✅ {ackResult}</p>}

        <div className="announcement-list">
          {announcements.map((a, i) => (
            <div key={i} className="announcement-item">
              <strong>{a.author}:</strong> {a.message}
              <span className="msg-time">
                {new Date(a.timestamp).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="code-note">
        <strong>Key code pattern (acknowledgement):</strong>
        <pre>{`// Client — 3rd arg is the ack callback
socket.emit("send_announcement", { message }, (ack) => {
  console.log("Server confirmed:", ack.timestamp);
});

// Server — call the callback to confirm
socket.on("send_announcement", ({ message }, ack) => {
  io.emit("announcement", payload); // broadcast to all
  ack({ success: true, timestamp: new Date().toISOString() });
});`}</pre>
      </div>
    </div>
  );
}
