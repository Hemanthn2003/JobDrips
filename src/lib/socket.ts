import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

let socket: Socket | null = null;
let users = 0;
let closeTimer: number | undefined;

/** One shared connection for the whole app. */
const acquire = (): Socket => {
  window.clearTimeout(closeTimer);
  users += 1;
  if (!socket) socket = io(API, { withCredentials: true, transports: ["websocket", "polling"] });
  return socket;
};

/** Disconnects shortly after the last component stops listening (handles React StrictMode remounts and logouts). */
const release = () => {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  closeTimer = window.setTimeout(() => {
    if (users === 0 && socket) { socket.disconnect(); socket = null; }
  }, 1500);
};

/**
 * Listen to a Socket.IO event for as long as the component is mounted.
 * The latest handler is always used, so it can read fresh state safely.
 *
 *   useSocketEvent<{ postId: string }>("post:updated", (p) => refetch(p.postId));
 */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const active = acquire();
    const listener = (payload: T) => handlerRef.current(payload);
    active.on(event, listener);
    return () => {
      active.off(event, listener);
      release();
    };
  }, [event]);
}