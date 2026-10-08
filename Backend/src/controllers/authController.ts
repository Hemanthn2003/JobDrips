import crypto from "node:crypto";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import {
  clearAuthCookies,
  comparePassword,
  createAccessToken,
  createRefreshToken,
  generateOtp,
  getRefreshTokenCookieName,
  hashPassword,
  hashValue,
  setAuthCookies,
} from "../utils/auth.js";
import { sendOtpEmail } from "../utils/email.js";
import { OtpVerification } from "../models/OtpVerification.js";
import { User } from "../models/User.js";

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

const normalizeEmail = (email: string) =>
  email.trim().toLowerCase();

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidPassword = (password: string) =>
  typeof password === "string" &&
  password.length >= 8;

const createOtpRecord = async (
  email: string,
  purpose: "SIGNUP" | "RESET_PASSWORD"
) => {
  const otp = generateOtp();

  await OtpVerification.deleteMany({
    email,
    purpose,
  });

  await OtpVerification.create({
    email,
    purpose,
    otpHash: hashValue(otp),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  return otp;
};

const issueLoginTokens = async (
  user: any,
  response: Response,
  rememberMe = true
) => {
  const accessToken =
    createAccessToken(user);

  const refreshToken =
    createRefreshToken(user);

  user.refreshTokenHash =
    hashValue(refreshToken);

  await user.save();

  setAuthCookies(
    response,
    accessToken,
    refreshToken,
    rememberMe
  );
};

export const requestSignupOtp = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    if (!isValidEmail(email)) {
      return response.status(400).json({
        message: "Enter a valid email address.",
      });
    }

    const existingUser =
      await User.findOne({ email });

    if (existingUser) {
      return response.status(409).json({
        code: "USER_EXISTS",
        message:
          "An account with this email already exists.",
      });
    }

    const otp =
      await createOtpRecord(
        email,
        "SIGNUP"
      );

    await sendOtpEmail(
      email,
      otp,
      "SIGNUP"
    );

    return response.json({
      message:
        "OTP sent to your email address.",
    });
  } catch (error) {
    console.error(
      "requestSignupOtp:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to send OTP right now.",
    });
  }
};

export const verifySignupOtp = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    const otp = String(
      request.body.otp || ""
    ).trim();

    if (!email || !otp) {
      return response.status(400).json({
        message:
          "Email and OTP are required.",
      });
    }

    const record =
      await OtpVerification.findOne({
        email,
        purpose: "SIGNUP",
        otpHash: hashValue(otp),
        verifiedAt: null,
      });

    if (
      !record ||
      record.expiresAt.getTime() <
        Date.now()
    ) {
      return response.status(400).json({
        message:
          "Invalid or expired OTP.",
      });
    }

    record.verifiedAt =
      new Date();

    await record.save();

    return response.json({
      message:
        "Email verified successfully.",
    });
  } catch (error) {
    console.error(
      "verifySignupOtp:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to verify OTP.",
    });
  }
};

export const signup = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    const password = String(
      request.body.password || ""
    );

    if (!isValidEmail(email)) {
      return response.status(400).json({
        message:
          "Enter a valid email address.",
      });
    }

    if (!isValidPassword(password)) {
      return response.status(400).json({
        message:
          "Password must contain at least 8 characters.",
      });
    }

    const existingUser =
      await User.findOne({ email });

    if (existingUser) {
      return response.status(409).json({
        code: "USER_EXISTS",
        message:
          "An account with this email already exists.",
      });
    }

    const verifiedOtp =
      await OtpVerification.findOne({
        email,
        purpose: "SIGNUP",
        verifiedAt: {
          $ne: null,
        },
      });

    if (
      !verifiedOtp ||
      verifiedOtp.expiresAt.getTime() <
        Date.now()
    ) {
      return response.status(400).json({
        message:
          "Verify your email with OTP before creating the account.",
      });
    }

    const passwordHash =
      await hashPassword(password);

    const user =
      await User.create({
        email,
        passwordHash,
      });

    await OtpVerification.deleteMany({
      email,
      purpose: "SIGNUP",
    });

    return response.status(201).json({
      message:
        "Account created successfully.",
      user: {
        id: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("signup:", error);

    return response.status(500).json({
      message:
        "Unable to create your account.",
    });
  }
};

export const login = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    const password = String(
      request.body.password || ""
    );

    if (!isValidEmail(email)) {
      return response.status(400).json({
        code: "INVALID_EMAIL",
        message:
          "Enter a valid email address.",
      });
    }

    if (!password) {
      return response.status(400).json({
        code: "PASSWORD_REQUIRED",
        message:
          "Enter your password.",
      });
    }

    const user =
      await User.findOne({ email });

    if (!user) {
      return response.status(404).json({
        code: "USER_NOT_FOUND",
        message:
          "User not found.",
      });
    }

    if (!user.passwordHash) {
      return response.status(400).json({
        code: "GOOGLE_ACCOUNT",
        message:
          "This account was created with Google. Continue with Google to sign in.",
      });
    }

    const matched =
      await comparePassword(
        password,
        user.passwordHash
      );

    if (!matched) {
      return response.status(401).json({
        code: "INVALID_PASSWORD",
        message:
          "Incorrect password.",
      });
    }

    const rememberMe =
      Boolean(request.body.rememberMe);

    await issueLoginTokens(
      user,
      response,
      rememberMe
    );

    return response.json({
      message:
        "Login successful.",
      user: {
        id: user._id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("login:", error);

    return response.status(500).json({
      message:
        "Unable to sign in right now.",
    });
  }
};

export const requestResetOtp = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    if (!isValidEmail(email)) {
      return response.status(400).json({
        message:
          "Enter a valid email address.",
      });
    }

    const user =
      await User.findOne({ email });

    if (!user) {
      return response.status(404).json({
        code: "USER_NOT_FOUND",
        message:
          "User not found.",
      });
    }

    const otp =
      await createOtpRecord(
        email,
        "RESET_PASSWORD"
      );

    await sendOtpEmail(
      email,
      otp,
      "RESET_PASSWORD"
    );

    return response.json({
      message:
        "Password reset OTP sent.",
    });
  } catch (error) {
    console.error(
      "requestResetOtp:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to send reset OTP.",
    });
  }
};

export const verifyResetOtp = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    const otp = String(
      request.body.otp || ""
    ).trim();

    const record =
      await OtpVerification.findOne({
        email,
        purpose: "RESET_PASSWORD",
        otpHash: hashValue(otp),
        verifiedAt: null,
      });

    if (
      !record ||
      record.expiresAt.getTime() <
        Date.now()
    ) {
      return response.status(400).json({
        message:
          "Invalid or expired OTP.",
      });
    }

    record.verifiedAt =
      new Date();

    await record.save();

    return response.json({
      message:
        "OTP verified successfully.",
    });
  } catch (error) {
    console.error(
      "verifyResetOtp:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to verify OTP.",
    });
  }
};

export const resetPassword = async (
  request: Request,
  response: Response
) => {
  try {
    const email = normalizeEmail(
      String(request.body.email || "")
    );

    const password = String(
      request.body.password || ""
    );

    if (!isValidPassword(password)) {
      return response.status(400).json({
        message:
          "Password must contain at least 8 characters.",
      });
    }

    const verifiedOtp =
      await OtpVerification.findOne({
        email,
        purpose: "RESET_PASSWORD",
        verifiedAt: {
          $ne: null,
        },
      });

    if (
      !verifiedOtp ||
      verifiedOtp.expiresAt.getTime() <
        Date.now()
    ) {
      return response.status(400).json({
        message:
          "Verify the reset OTP before changing your password.",
      });
    }

    const user =
      await User.findOne({ email });

    if (!user) {
      return response.status(404).json({
        code: "USER_NOT_FOUND",
        message:
          "User not found.",
      });
    }

    user.passwordHash =
      await hashPassword(password);

    user.refreshTokenHash = null;

    await user.save();

    await OtpVerification.deleteMany({
      email,
      purpose: "RESET_PASSWORD",
    });

    clearAuthCookies(response);

    return response.json({
      message:
        "Password changed successfully.",
    });
  } catch (error) {
    console.error(
      "resetPassword:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to change password.",
    });
  }
};

export const refreshAccessToken = async (
  request: Request,
  response: Response
) => {
  try {
    const refreshToken =
      request.cookies[
        getRefreshTokenCookieName()
      ];

    if (!refreshToken) {
      return response.status(401).json({
        message:
          "Refresh token is missing.",
      });
    }

    const secret =
      process.env.JWT_REFRESH_SECRET;

    if (!secret) {
      throw new Error(
        "JWT_REFRESH_SECRET is missing."
      );
    }

    const payload =
      jwt.verify(
        refreshToken,
        secret
      ) as jwt.JwtPayload;

    if (
      payload.type !== "refresh" ||
      !payload.sub
    ) {
      return response.status(401).json({
        message:
          "Invalid refresh token.",
      });
    }

    const user =
      await User.findById(
        payload.sub
      );

    if (
      !user ||
      !user.refreshTokenHash ||
      user.refreshTokenHash !==
        hashValue(refreshToken)
    ) {
      return response.status(401).json({
        message:
          "Refresh token is invalid.",
      });
    }

    await issueLoginTokens(
      user,
      response
    );

    return response.json({
      message:
        "Access token refreshed.",
    });
  } catch (error) {
    clearAuthCookies(response);

    return response.status(401).json({
      message:
        "Session expired. Please sign in again.",
    });
  }
};

export const logout = async (
  request: Request,
  response: Response
) => {
  try {
    const refreshToken =
      request.cookies[
        getRefreshTokenCookieName()
      ];

    if (refreshToken) {
      const secret =
        process.env.JWT_REFRESH_SECRET;

      if (secret) {
        try {
          const payload =
            jwt.verify(
              refreshToken,
              secret
            ) as jwt.JwtPayload;

          if (payload.sub) {
            await User.findByIdAndUpdate(
              payload.sub,
              {
                refreshTokenHash: null,
              }
            );
          }
        } catch {
          // Token may already be expired.
        }
      }
    }

    clearAuthCookies(response);

    return response.json({
      message:
        "Logged out successfully.",
    });
  } catch (error) {
    clearAuthCookies(response);

    return response.json({
      message:
        "Logged out successfully.",
    });
  }
};

/* =========================================================
   GOOGLE OAUTH
========================================================= */

const getGoogleClient = () => {
  const clientId =
    process.env.GOOGLE_CLIENT_ID;

  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET;

  const callbackUrl =
    process.env.GOOGLE_CALLBACK_URL;

  if (
    !clientId ||
    !clientSecret ||
    !callbackUrl
  ) {
    throw new Error(
      "Google OAuth environment variables are missing."
    );
  }

  return new OAuth2Client(
    clientId,
    clientSecret,
    callbackUrl
  );
};

export const googleLogin = async (
  request: Request,
  response: Response
) => {
  try {
    const client =
      getGoogleClient();

    const state =
      cryptoRandomState();

    response.cookie(
      "jobdrips_google_state",
      state,
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV ===
          "production",
        maxAge: 10 * 60 * 1000,
        path: "/",
      }
    );

    const authorizationUrl =
      client.generateAuthUrl({
        access_type: "offline",
        scope: [
          "openid",
          "email",
          "profile",
        ],
        prompt: "select_account",
        state,
      });

    return response.redirect(
      authorizationUrl
    );
  } catch (error) {
    console.error(
      "googleLogin:",
      error
    );

    return response.status(500).send(
      "Google authentication is not configured correctly."
    );
  }
};

export const googleCallback = async (
  request: Request,
  response: Response
) => {
  try {
    const code = String(
      request.query.code || ""
    );

    const receivedState =
      String(
        request.query.state || ""
      );

    const storedState =
      request.cookies
        .jobdrips_google_state;

    response.clearCookie(
      "jobdrips_google_state",
      {
        httpOnly: true,
        sameSite: "lax",
        secure:
          process.env.NODE_ENV ===
          "production",
        path: "/",
      }
    );

    if (
      !code ||
      !receivedState ||
      !storedState ||
      receivedState !==
        storedState
    ) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=state`
      );
    }

    const client =
      getGoogleClient();

    const { tokens } =
      await client.getToken(code);

    if (!tokens.id_token) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=identity`
      );
    }

    const googleClientId =
      process.env.GOOGLE_CLIENT_ID;

    if (!googleClientId) {
      throw new Error(
        "GOOGLE_CLIENT_ID is missing."
      );
    }

    const ticket =
      await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: googleClientId,
      });

    const payload =
      ticket.getPayload();

    if (
      !payload ||
      !payload.email ||
      !payload.sub
    ) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=identity`
      );
    }

    const email =
      normalizeEmail(payload.email);

    let user =
      await User.findOne({ email });

    if (!user) {
      user = await User.create({
        email,
        googleId: payload.sub,
        name:
          payload.name || "",
        profilePhoto:
          payload.picture || "",
        passwordHash: null,
      });
    } else {
      if (
        !user.googleId
      ) {
        user.googleId =
          payload.sub;
      }

      if (
        !user.name &&
        payload.name
      ) {
        user.name =
          payload.name;
      }

      if (
        !user.profilePhoto &&
        payload.picture
      ) {
        user.profilePhoto =
          payload.picture;
      }

      await user.save();
    }

    await issueLoginTokens(
      user,
      response
    );

    return response.redirect(
      `${CLIENT_URL}/?google=success`
    );
  } catch (error) {
    console.error(
      "googleCallback:",
      error
    );

    return response.redirect(
      `${CLIENT_URL}/?googleError=failed`
    );
  }
};

const cryptoRandomState = () =>
  crypto.randomBytes(32).toString("hex");
