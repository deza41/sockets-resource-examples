/**
 * ============================================================
 *  EXAMPLE: Connect 4 over PeerJS  —  direct 1:1 connection
 * ============================================================
 *
 *  Unlike the mesh chat/game pages, this example uses NO
 *  Socket.io signaling at all. Connect 4 is exactly two players,
 *  so we don't need a "room presence" system — PeerJS's own ID
 *  broker is enough: one player gets a short code, shares it with
 *  their opponent out-of-band (Slack, in person, whatever), and
 *  the opponent calls `peer.connect(thatCode)` directly.
 *
 *  ROLES
 *  ─────
 *  Host    — generates a code, waits, accepts the incoming
 *            DataConnection via peer.on("connection", ...).
 *            Plays 🔴 and moves first.
 *  Joiner  — types the host's code, calls peer.connect(code).
 *            Plays 🟡 and moves second.
 *
 *  GAME SYNC
 *  ─────────
 *  The board itself is never sent over the wire — only the
 *  column a player dropped into (`{ type: "move", col }`). Both
 *  sides run the identical drop/win-check logic locally, and
 *  since a WebRTC DataChannel is reliable + ordered (like TCP)
 *  and only one move is ever in flight at a time (turn-based),
 *  both boards stay in lockstep without ever exchanging state.
 * ============================================================
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import Peer from "peerjs";
import { PEER_SERVER_OPTS } from "../lib/peer";

const ROWS = 6;
const COLS = 7;
const RED = 1;
const YELLOW = 2;

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity
function generateRoomCode() {
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function makeEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function lowestEmptyRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) return r;
  }
  return -1;
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== 0);
}

const DIRECTIONS = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal ↘
  [1, -1], // diagonal ↙
];

function checkWin(board, row, col, color) {
  for (const [dr, dc] of DIRECTIONS) {
    const cells = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        cells.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

export default function PeerConnect4App() {
  const [myId, setMyId] = useState("");
  const [opponentInput, setOpponentInput] = useState("");
  const [role, setRole] = useState(null); // "host" | "joiner"
  const [connStatus, setConnStatus] = useState("connecting-broker");
  const [board, setBoard] = useState(makeEmptyBoard);
  const [myTurn, setMyTurn] = useState(false);
  const [winner, setWinner] = useState(null); // null | "me" | "opponent" | "draw"
  const [winningCells, setWinningCells] = useState([]);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const myColorRef = useRef(null);

  const applyMove = useCallback((col, color) => {
    setBoard((prev) => {
      const row = lowestEmptyRow(prev, col);
      if (row === -1) return prev;

      const next = prev.map((r) => [...r]);
      next[row][col] = color;

      const win = checkWin(next, row, col, color);
      if (win) {
        setWinner(color === myColorRef.current ? "me" : "opponent");
        setWinningCells(win);
      } else if (isBoardFull(next)) {
        setWinner("draw");
      }
      return next;
    });
    setMyTurn(color !== myColorRef.current);
  }, []);

  const resetBoard = useCallback((broadcast) => {
    setBoard(makeEmptyBoard());
    setWinner(null);
    setWinningCells([]);
    setMyTurn(myColorRef.current === RED);
    if (broadcast) connRef.current?.send({ type: "restart" });
  }, []);

  const wireUpGameConnection = useCallback(
    (conn) => {
      conn.on("open", () => {
        setConnStatus("playing");
        resetBoard(false);
      });
      conn.on("data", (msg) => {
        if (msg.type === "move") {
          const opponentColor = myColorRef.current === RED ? YELLOW : RED;
          applyMove(msg.col, opponentColor);
        } else if (msg.type === "restart") {
          resetBoard(false);
        }
      });
      conn.on("close", () => setConnStatus("opponent-left"));
      conn.on("error", (err) => console.error("[PeerJS] connection error:", err));
    },
    [applyMove, resetBoard]
  );

  useEffect(() => {
    const peer = new Peer(generateRoomCode(), PEER_SERVER_OPTS);
    peerRef.current = peer;

    peer.on("open", (id) => {
      setMyId(id);
      setConnStatus("waiting");
    });

    // Someone connected to OUR code — we're the host.
    peer.on("connection", (conn) => {
      if (connRef.current) {
        conn.close(); // already playing someone — reject extra challengers
        return;
      }
      connRef.current = conn;
      setRole("host");
      myColorRef.current = RED;
      wireUpGameConnection(conn);
    });

    peer.on("error", (err) => {
      console.error("[PeerJS] error:", err);
      setConnStatus("error");
    });

    return () => {
      connRef.current?.close();
      peerRef.current?.destroy();
    };
  }, [wireUpGameConnection]);

  function handleJoin(e) {
    e.preventDefault();
    const code = opponentInput.trim().toUpperCase();
    if (!code || !peerRef.current || connRef.current) return;

    setConnStatus("connecting");
    setRole("joiner");
    myColorRef.current = YELLOW;

    const conn = peerRef.current.connect(code);
    connRef.current = conn;
    wireUpGameConnection(conn);
    conn.on("error", () => setConnStatus("error"));
  }

  function handleColumnClick(col) {
    if (!myTurn || winner || connStatus !== "playing") return;
    if (lowestEmptyRow(board, col) === -1) return;
    applyMove(col, myColorRef.current);
    connRef.current?.send({ type: "move", col });
  }

  function copyCode() {
    navigator.clipboard?.writeText(myId);
  }

  const myColorLabel = myColorRef.current === RED ? "🔴 Red" : myColorRef.current === YELLOW ? "🟡 Yellow" : "—";

  return (
    <div className="page">
      <div className="page-header">
        <h2>🔴🟡 Connect 4 (PeerJS)</h2>
        <p>
          Two players, one direct DataConnection — no room/presence system
          needed. Share your code with a friend in a second tab to play.
        </p>
        <span className={`badge ${connStatus === "playing" ? "connected" : connStatus === "connecting-broker" || connStatus === "connecting" ? "info" : "disconnected"}`}>
          {connStatus}
        </span>
      </div>

      {connStatus !== "playing" && winner === null && (
        <div className="join-form" style={{ maxWidth: 460 }}>
          <h3>Start or Join a Game</h3>

          <div>
            <div className="hint">Your game code (share this with your opponent):</div>
            <div className="code-display">
              <span>{myId || "…"}</span>
              <button type="button" className="btn-small" onClick={copyCode} disabled={!myId}>
                Copy
              </button>
            </div>
            {connStatus === "waiting" && <p className="hint">Waiting for someone to connect…</p>}
          </div>

          <div style={{ textAlign: "center", color: "#6e7681", fontSize: "0.8rem" }}>— or —</div>

          <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <input
              placeholder="Enter opponent's code"
              value={opponentInput}
              onChange={(e) => setOpponentInput(e.target.value)}
              disabled={connStatus === "connecting" || role === "host"}
            />
            <button type="submit" disabled={connStatus === "connecting" || role === "host"}>
              Join Game
            </button>
          </form>
        </div>
      )}

      {connStatus === "opponent-left" && (
        <div className="error">Your opponent disconnected. Refresh the page to start a new game.</div>
      )}

      {(connStatus === "playing" || winner !== null) && connStatus !== "opponent-left" && (
        <div className="chat-layout">
          <aside className="user-list">
            <h4>Game</h4>
            <div className="user-item">
              <div>You: {myColorLabel}</div>
            </div>
            <div className="user-item">
              <div>{winner ? "Game over" : myTurn ? "🟢 Your turn" : "🟡 Opponent's turn"}</div>
            </div>
            {winner && (
              <div className="user-item" style={{ marginTop: "0.5rem" }}>
                <strong>
                  {winner === "draw" ? "🤝 Draw!" : winner === "me" ? "🎉 You win!" : "😢 Opponent wins"}
                </strong>
                <div style={{ marginTop: "0.5rem" }}>
                  <button type="button" className="btn-primary" onClick={() => resetBoard(true)}>
                    Play Again
                  </button>
                </div>
              </div>
            )}
            <div className="hint" style={{ marginTop: "1rem" }}>
              Your code: <strong>{myId}</strong>
            </div>
          </aside>

          <div className="chat-panel" style={{ alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
            <div className="connect4-board">
              {board.map((rowCells, r) =>
                rowCells.map((cell, c) => {
                  const isWinning = winningCells.some(([wr, wc]) => wr === r && wc === c);
                  return (
                    <div
                      key={`${r}-${c}`}
                      className="connect4-cell-wrap"
                      onClick={() => handleColumnClick(c)}
                    >
                      <div
                        className={`connect4-cell ${cell === RED ? "red" : cell === YELLOW ? "yellow" : ""} ${isWinning ? "win" : ""}`}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <div className="code-note">
        <strong>Key idea:</strong>
        <pre>{`// Only the column index ever crosses the wire — both sides run
// the same drop + win-check logic locally and stay in sync
// because the DataChannel is ordered & reliable (like TCP) and
// it's turn-based, so there's never more than one move in flight.

conn.send({ type: "move", col });

conn.on("data", (msg) => {
  if (msg.type === "move") applyMove(msg.col, opponentColor);
});`}</pre>
      </div>
    </div>
  );
}
