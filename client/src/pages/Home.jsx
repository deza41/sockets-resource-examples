import React from "react";
import { Link } from "react-router-dom";

const examples = [
  {
    path: "/chat",
    emoji: "💬",
    title: "Chat App",
    description:
      "Multi-room chat with join/leave events and a live user list. Demonstrates socket.join(), socket.to(room), and disconnect cleanup.",
    tags: ["socket.io", "rooms", "broadcast"],
  },
  {
    path: "/broadcast",
    emoji: "📡",
    title: "Broadcast / Ticker",
    description:
      "Server pushes a fake BTC price ticker to all connected clients on a schedule. Also shows server-wide announcements with acknowledgements.",
    tags: ["socket.io", "io.emit", "acknowledgements", "setInterval"],
  },
  {
    path: "/private",
    emoji: "🔒",
    title: "Private Messaging",
    description:
      "Direct messages between two users. The server maps usernames to socket IDs and uses io.to(socketId) to target a single connection.",
    tags: ["socket.io", "io.to(id)", "user registry"],
  },
  {
    path: "/rooms",
    emoji: "🚪",
    title: "Rooms + Typing Indicators",
    description:
      "Full room lifecycle with create, join, leave, typing start/stop indicators, and read receipts. Mirrors a Slack-style workspace.",
    tags: ["socket.io", "rooms", "typing", "receipts"],
  },
  {
    path: "/mesh",
    emoji: "🕸️",
    title: "P2P Mesh Chat (WebRTC)",
    description:
      "Browser-to-browser peer-to-peer mesh using WebRTC DataChannels. Socket.io is only used for signaling (SDP + ICE). Once connected, no server traffic.",
    tags: ["WebRTC", "DataChannel", "signaling", "peer-to-peer"],
  },
  {
    path: "/mesh-game",
    emoji: "🎮",
    title: "P2P Mesh Game (WebRTC)",
    description:
      "Walk around a shared map with other players. Reuses the mesh signaling flow, but broadcasts live x/y position over DataChannels instead of chat messages.",
    tags: ["WebRTC", "DataChannel", "game loop", "peer-to-peer"],
  },
  {
    path: "/peerjs-mesh",
    emoji: "🧩",
    title: "P2P Mesh Chat (PeerJS)",
    description:
      "The same mesh chat as the raw-WebRTC example, but using the peerjs library — it wraps SDP/ICE signaling behind peer.connect()/peer.on('connection'). Self-hosted PeerServer at /peerjs.",
    tags: ["WebRTC", "PeerJS", "DataConnection", "peer-to-peer"],
  },
  {
    path: "/connect4",
    emoji: "🔴🟡",
    title: "Connect 4 (PeerJS)",
    description:
      "A direct 1:1 PeerJS DataConnection, no room/presence system needed — generate a code, share it, and play. Only the column played is ever sent over the wire.",
    tags: ["WebRTC", "PeerJS", "game", "peer-to-peer"],
  },
  {
    path: "/share-code",
    emoji: "🔗",
    title: "P2P Group Chat (Share Code — No Server)",
    description:
      "Zero server of ours involved in signaling — copy-paste offer/answer codes by hand. A host relays messages between joiners over a star of pairwise DataChannels, so it scales past 1:1.",
    tags: ["WebRTC", "manual signaling", "no server", "peer-to-peer"],
  },
];

export default function Home() {
  return (
    <div className="page">
      <div className="page-header">
        <h2>Socket.io + WebRTC Examples</h2>
        <p>
          A collection of annotated, beginner-friendly examples showing how to
          build real-time features. Browse the examples below — each one has
          inline code comments explaining every concept.
        </p>
      </div>

      <div className="card-grid">
        {examples.map((ex) => (
          <Link to={ex.path} className="example-card" key={ex.path}>
            <div className="card-emoji">{ex.emoji}</div>
            <h3>{ex.title}</h3>
            <p>{ex.description}</p>
            <div className="tag-list">
              {ex.tags.map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>

      <div className="info-box">
        <h3>📋 Prerequisites</h3>
        <ol>
          <li>
            Start the Express server: <code>npm run server</code> (port 3001)
          </li>
          <li>
            Start this React app: <code>npm run client</code> (port 5173)
          </li>
          <li>
            Open multiple browser tabs to simulate multiple users!
          </li>
        </ol>
      </div>
    </div>
  );
}
