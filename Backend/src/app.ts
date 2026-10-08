import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import authRoutes from "./routes/authRoutes.js";

const app = express();

const clientUrl =
  process.env.CLIENT_URL ||
  "http://localhost:5173";

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  })
);

app.use(
  express.json()
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.use(cookieParser());

app.get(
  "/api/health",
  (_request, response) => {
    response.json({
      success: true,
      message:
        "JobDrips backend is running.",
    });
  }
);

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  (
    _request,
    response
  ) => {
    response.status(404).json({
      message:
        "API route not found.",
    });
  }
);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(error);

    response.status(500).json({
      message:
        "Internal server error.",
    });
  }
);

export default app;
