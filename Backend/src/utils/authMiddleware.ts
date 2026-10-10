
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getAccessTokenCookieName } from "./auth.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export const authenticate = (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
) => {
  try {
    const authorizationHeader = request.headers.authorization;

    const bearerToken = authorizationHeader?.match(
      /^Bearer\s+(\S+)$/i
    )?.[1];

    const token =
      request.cookies?.[getAccessTokenCookieName()] ||
      bearerToken;

    if (!token) {
      response.status(401).json({
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
      return;
    }

    const secret = process.env.JWT_ACCESS_SECRET;

    if (!secret) {
      throw new Error("JWT_ACCESS_SECRET is missing.");
    }

    const payload = jwt.verify(token, secret) as jwt.JwtPayload;

    if (
      payload.type !== "access" ||
      !payload.sub
    ) {
      response.status(401).json({
        code: "INVALID_ACCESS_TOKEN",
        message: "Invalid access token.",
      });
      return;
    }

    request.userId = payload.sub;
    next();
  } catch {
    response.status(401).json({
      code: "INVALID_ACCESS_TOKEN",
      message: "Session expired or invalid.",
    });
  }
};
