import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import feedRoutes from "./routes/feedRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";

const app = express();

const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

// CORS configuration
app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);

// Request body parsing
app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  }),
);

// Cookie parsing
app.use(cookieParser());

// Backend health check
app.get("/api/health", (_request, response) => {
  response.json({
    success: true,
    message: "JobDrips backend is running.",
  });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Cloudinary image upload routes
app.use("/api/uploads", uploadRoutes);

// User profile routes
// Keep all API routes before the 404 handler.
app.use("/api/profiles", profileRoutes);

// Feed routes
app.use("/api/feed", feedRoutes);

// Post routes (like, save, share, comments, edit, report ...)
app.use("/api/posts", postRoutes);

// Message routes (messages, shared posts, mention notifications)
app.use("/api/messages", messageRoutes);

// Handle unknown routes
app.use((_request, response) => {
  response.status(404).json({
    message: "API route not found.",
  });
});

// Global error handler
app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);

    response.status(500).json({
      message: "Internal server error.",
    });
  },
);

export default app;
