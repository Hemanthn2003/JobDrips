import type { Server as HttpServer } from "node:http";
import mongoose from "mongoose";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { getAccessTokenCookieName } from "./auth.js";

let io: Server | null = null;
type ChangeStreamLike = {
  on: (event: string, listener: (...args: any[]) => void) => unknown;
};

let databaseChangeStream: ChangeStreamLike | null = null;

export const attachRealtime = (httpServer: HttpServer): Server => {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  io = new Server(httpServer, {
    cors: { origin: clientUrl, credentials: true },
    transports: ["websocket", "polling"],
  });
  io.use((socket: any, next: (error?: Error) => void) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie || "";
      const cookieName = getAccessTokenCookieName();
      const cookieToken = cookieHeader.split(";").map((part: string) => part.trim()).find((part: string) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      const token = socket.handshake.auth?.token || cookieToken;
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!token || !secret) return next(new Error("Authentication required"));
      const payload = jwt.verify(token, secret) as jwt.JwtPayload;
      if (payload.type !== "access" || !payload.sub) return next(new Error("Invalid access token"));
      socket.data.userId = String(payload.sub);
      next();
    } catch {
      next(new Error("Invalid access token"));
    }
  });
  io.on("connection", (socket: any) => {
    socket.join(`user:${String(socket.data.userId)}`);
  });
  return io;
};

export const emitToUser = (userId: string, event: string, payload: unknown): void => {
  io?.to(`user:${userId}`).emit(event, payload);
};

export const emitToAllUsers = (event: string, payload: unknown): void => {
  io?.emit(event, payload);
};

export const emitToConversation = (conversationId: string, event: string, payload: unknown): void => {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
};

/**
 * MongoDB change-stream bridge. This emits only a generic invalidation event, never
 * document contents. The frontend then reloads through its authenticated API, so
 * MongoDB data remains protected by the existing route permissions.
 * MongoDB Atlas/replica-set deployments support change streams; standalone MongoDB
 * may reject watch(), in which case targeted controller events still work.
 */
export const startDatabaseRealtime = async (): Promise<void> => {
  if (databaseChangeStream) return;
  const db = mongoose.connection.db;
  if (!db) return;
  try {
    const stream: ChangeStreamLike = db.watch([], { maxAwaitTimeMS: 1000 }) as unknown as ChangeStreamLike;
    databaseChangeStream = stream;
    stream.on("change", (change: { ns?: { coll?: string }; operationType?: string }) => {
      io?.emit("app:data-changed", {
        collection: change.ns?.coll || "unknown",
        operation: change.operationType,
        at: new Date().toISOString(),
      });
    });
    stream.on("error", (error: Error) => {
      console.error("MongoDB realtime change stream stopped:", error.message);
      if (databaseChangeStream === stream) databaseChangeStream = null;
    });
    console.log("MongoDB change stream realtime updates enabled.");
  } catch (error) {
    databaseChangeStream = null;
    console.warn("MongoDB change streams are unavailable; targeted Socket.IO events remain enabled.", error);
  }
};
