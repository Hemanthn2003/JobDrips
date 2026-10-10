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
    throw new Error(
      `${name} is missing in Backend/.env`
    );
  }

  return value;
};

/* =========================================================
   CONVERT JWT/Cookie DURATION TO MILLISECONDS
========================================================= */

const parseDurationMs = (
  value: string,
  fallbackMs = 15 * 60 * 1000
): number => {
  const match = value.match(
    /^(\d+)(s|m|h|d)$/
  );

  if (!match) {
    return fallbackMs;
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

/* =========================================================
   GENERAL HASH
========================================================= */

export const hashValue = (
  value: string
) =>
  crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");

/* =========================================================
   OTP
========================================================= */

export const generateOtp = () =>
  crypto
    .randomInt(100000, 1000000)
    .toString();

/* =========================================================
   PASSWORD HASHING
========================================================= */

export const hashPassword = (
  password: string
) =>
  bcrypt.hash(password, 12);

export const comparePassword = (
  password: string,
  passwordHash: string
) =>
  bcrypt.compare(
    password,
    passwordHash
  );

/* =========================================================
   ACCESS TOKEN
   ---------------------------------------------------------
   Access token:
   - Always 15 minutes by default
   - Used for authenticated API requests
========================================================= */

export const createAccessToken = (
  user: UserDocument
) => {
  const secret =
    getRequiredEnv(
      "JWT_ACCESS_SECRET"
    );

  const expiresIn =
    process.env.ACCESS_TOKEN_EXPIRES_IN ||
    "15m";

  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      type: "access",
    },
    secret,
    {
      expiresIn:
        expiresIn as jwt.SignOptions["expiresIn"],
    }
  );
};

/* =========================================================
   REFRESH TOKEN
   ---------------------------------------------------------
   Remember Me = true
       → 30 days

   Remember Me = false
       → REFRESH_TOKEN_EXPIRES_IN
       → normally 7 days

   rememberMe is stored INSIDE the JWT so that the
   refresh controller can preserve the original choice.
========================================================= */

export const createRefreshToken = (
  user: UserDocument,
  rememberMe = false
) => {
  const secret =
    getRequiredEnv(
      "JWT_REFRESH_SECRET"
    );

  const expiresIn = rememberMe
    ? "30d"
    : (
        process.env
          .REFRESH_TOKEN_EXPIRES_IN ||
        "7d"
      );

  return jwt.sign(
    {
      sub: user._id.toString(),
      type: "refresh",
      rememberMe,
    },
    secret,
    {
      expiresIn:
        expiresIn as jwt.SignOptions["expiresIn"],
    }
  );
};

/* =========================================================
   COOKIE CONFIGURATION
========================================================= */

const cookieBase = {
  httpOnly: true,

  /*
   * Allows the frontend and backend to work together
   * during the current local development setup.
   */
  sameSite: "lax" as const,

  /*
   * HTTPS only in production.
   * localhost development remains HTTP.
   */
  secure:
    process.env.NODE_ENV ===
    "production",

  path: "/",
};

/* =========================================================
   AUTH COOKIES
   ---------------------------------------------------------
   ACCESS TOKEN:
       15 minutes by default

   REFRESH TOKEN:

       Remember Me = true
       → 30 days persistent cookie

       Remember Me = false
       → session cookie
       → JWT itself expires according to
         REFRESH_TOKEN_EXPIRES_IN, normally 7 days
========================================================= */

export const setAuthCookies = (
  response: Response,
  accessToken: string,
  refreshToken: string,
  rememberMe = false
) => {
  /* =======================================================
     ACCESS TOKEN COOKIE
  ======================================================== */

  const accessMaxAge =
    parseDurationMs(
      process.env
        .ACCESS_TOKEN_EXPIRES_IN ||
        "15m",
      15 * 60 * 1000
    );

  response.cookie(
    ACCESS_COOKIE,
    accessToken,
    {
      ...cookieBase,
      maxAge: accessMaxAge,
    }
  );

  /* =======================================================
     REFRESH TOKEN COOKIE
  ======================================================== */

  if (rememberMe) {
    /*
     * Remember Me checked:
     *
     * Browser cookie = 30 days
     * JWT = 30 days
     */

    const refreshMaxAge =
      30 *
      24 *
      60 *
      60 *
      1000;

    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      {
        ...cookieBase,
        maxAge: refreshMaxAge,
      }
    );
  } else {
    /*
     * Remember Me NOT checked:
     *
     * Do not create a persistent cookie.
     * The browser treats this as a session cookie.
     *
     * The JWT itself still has the configured
     * refresh-token expiration, normally 7 days.
     */

    response.cookie(
      REFRESH_COOKIE,
      refreshToken,
      {
        ...cookieBase,
      }
    );
  }
};

/* =========================================================
   CLEAR AUTH COOKIES
========================================================= */

export const clearAuthCookies = (
  response: Response
) => {
  response.clearCookie(
    ACCESS_COOKIE,
    cookieBase
  );

  response.clearCookie(
    REFRESH_COOKIE,
    cookieBase
  );
};

/* =========================================================
   COOKIE NAME HELPERS
========================================================= */

export const getRefreshTokenCookieName =
  () => REFRESH_COOKIE;

export const getAccessTokenCookieName =
  () => ACCESS_COOKIE;