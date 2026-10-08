import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import type { UserDocument } from "../models/User.js";

const ACCESS_COOKIE = "jobdrips_access_token";
const REFRESH_COOKIE = "jobdrips_refresh_token";

const getRequiredEnv = (name: string) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in Backend/.env`);
  }

  return value;
};

const parseDurationMs = (value: string): number => {
  const match = value.match(/^(\d+)(s|m|h|d)$/);

  if (!match) {
    return 15 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2];

  const multiplier =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60 * 1000
        : unit === "h"
          ? 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;

  return amount * multiplier;
};

export const hashValue = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

export const generateOtp = () =>
  crypto.randomInt(100000, 1000000).toString();

export const hashPassword = (password: string) =>
  bcrypt.hash(password, 12);

export const comparePassword = (
  password: string,
  passwordHash: string
) => bcrypt.compare(password, passwordHash);

export const createAccessToken = (user: UserDocument) => {
  const secret = getRequiredEnv("JWT_ACCESS_SECRET");

  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      type: "access",
    },
    secret,
    {
      expiresIn: (process.env.ACCESS_TOKEN_EXPIRES_IN || "15m") as jwt.SignOptions["expiresIn"],
    }
  );
};

export const createRefreshToken = (user: UserDocument) => {
  const secret = getRequiredEnv("JWT_REFRESH_SECRET");

  return jwt.sign(
    {
      sub: user._id.toString(),
      type: "refresh",
    },
    secret,
    {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"],
    }
  );
};

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const setAuthCookies = (
  response: Response,
  accessToken: string,
  refreshToken: string,
  rememberMe = true
) => {
  const accessMaxAge = parseDurationMs(
    process.env.ACCESS_TOKEN_EXPIRES_IN || "15m"
  );

  const refreshMaxAge = parseDurationMs(
    process.env.REFRESH_TOKEN_EXPIRES_IN || "7d"
  );

  response.cookie(
    ACCESS_COOKIE,
    accessToken,
    {
      ...cookieBase,
      maxAge: accessMaxAge,
    }
  );

  response.cookie(
    REFRESH_COOKIE,
    refreshToken,
    rememberMe
      ? {
          ...cookieBase,
          maxAge: refreshMaxAge,
        }
      : cookieBase
  );
};

export const clearAuthCookies = (response: Response) => {
  response.clearCookie(ACCESS_COOKIE, cookieBase);
  response.clearCookie(REFRESH_COOKIE, cookieBase);
};

export const getRefreshTokenCookieName = () =>
  REFRESH_COOKIE;

export const getAccessTokenCookieName = () =>
  ACCESS_COOKIE;
