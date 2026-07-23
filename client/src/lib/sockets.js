/**
 * ============================================================
 *  SOCKET INSTANCES
 * ============================================================
 *
 *  We create one socket per namespace here and export them as
 *  singletons so the same underlying TCP connection is reused
 *  across the whole app.
 *
 *  Each socket is created with `autoConnect: false` so that
 *  components can connect and disconnect on-mount/unmount
 *  without causing stale connections.
 *
 *  Usage in a component:
 *    import { chatSocket } from "../lib/sockets";
 *
 *    useEffect(() => {
 *      chatSocket.connect();
 *      return () => { chatSocket.disconnect(); };
 *    }, []);
 * ============================================================
 */

import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const OPTS = {
  autoConnect: false, // we control when to connect
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
};

export const chatSocket = io(`${SERVER_URL}/chat`, OPTS);
export const broadcastSocket = io(`${SERVER_URL}/broadcast`, OPTS);
export const privateSocket = io(`${SERVER_URL}/private`, OPTS);
export const roomsSocket = io(`${SERVER_URL}/rooms`, OPTS);
export const signalingSocket = io(`${SERVER_URL}/signaling`, OPTS);
