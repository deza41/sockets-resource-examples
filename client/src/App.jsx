import React from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import Home from "./pages/Home";
import ChatApp from "./pages/ChatApp";
import BroadcastApp from "./pages/BroadcastApp";
import PrivateMessaging from "./pages/PrivateMessaging";
import RoomsApp from "./pages/RoomsApp";
import MeshApp from "./pages/MeshApp";
import MeshGameApp from "./pages/MeshGameApp";
import PeerJsMeshApp from "./pages/PeerJsMeshApp";
import PeerConnect4App from "./pages/PeerConnect4App";
import "./styles/app.css";

export default function App() {
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>🔌 Socket Examples</h1>
          <p>Socket.io + WebRTC</p>
        </div>
        <ul className="nav-list">
          <li>
            <NavLink to="/" end className={({ isActive }) => isActive ? "active" : ""}>
              🏠 Home
            </NavLink>
          </li>
          <li className="nav-section">Socket.io Examples</li>
          <li>
            <NavLink to="/chat" className={({ isActive }) => isActive ? "active" : ""}>
              💬 Chat App
            </NavLink>
          </li>
          <li>
            <NavLink to="/broadcast" className={({ isActive }) => isActive ? "active" : ""}>
              📡 Broadcast / Ticker
            </NavLink>
          </li>
          <li>
            <NavLink to="/private" className={({ isActive }) => isActive ? "active" : ""}>
              🔒 Private Messaging
            </NavLink>
          </li>
          <li>
            <NavLink to="/rooms" className={({ isActive }) => isActive ? "active" : ""}>
              🚪 Rooms + Typing
            </NavLink>
          </li>
          <li className="nav-section">WebRTC / Mesh</li>
          <li>
            <NavLink to="/mesh" className={({ isActive }) => isActive ? "active" : ""}>
              🕸️ P2P Mesh Chat
            </NavLink>
          </li>
          <li>
            <NavLink to="/mesh-game" className={({ isActive }) => isActive ? "active" : ""}>
              🎮 P2P Mesh Game
            </NavLink>
          </li>
          <li>
            <NavLink to="/peerjs-mesh" className={({ isActive }) => isActive ? "active" : ""}>
              🧩 P2P Mesh Chat (PeerJS)
            </NavLink>
          </li>
          <li>
            <NavLink to="/connect4" className={({ isActive }) => isActive ? "active" : ""}>
              🔴🟡 Connect 4 (PeerJS)
            </NavLink>
          </li>
        </ul>
      </nav>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/chat" element={<ChatApp />} />
          <Route path="/broadcast" element={<BroadcastApp />} />
          <Route path="/private" element={<PrivateMessaging />} />
          <Route path="/rooms" element={<RoomsApp />} />
          <Route path="/mesh" element={<MeshApp />} />
          <Route path="/mesh-game" element={<MeshGameApp />} />
          <Route path="/peerjs-mesh" element={<PeerJsMeshApp />} />
          <Route path="/connect4" element={<PeerConnect4App />} />
        </Routes>
      </main>
    </div>
  );
}
