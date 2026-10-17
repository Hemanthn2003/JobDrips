import crypto from "node:crypto";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import jwt from "jsonwebtoken";
import {
  clearAuthCookies,
  comparePassword,
  createAccessToken,
  createRefreshToken,
  generateOtp,
  getAccessTokenCookieName,
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
  rememberMe = false
) => {
  const accessToken =
    createAccessToken(user);

  const refreshToken =
    createRefreshToken(
      user,
      rememberMe
    );

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
    /* =====================================================
       GET REFRESH TOKEN FROM COOKIE
    ====================================================== */

    const refreshToken =
      request.cookies?.[
        getRefreshTokenCookieName()
      ];

    if (!refreshToken) {
      return response.status(401).json({
        code: "REFRESH_TOKEN_MISSING",
        message:
          "Refresh token is missing.",
      });
    }

    /* =====================================================
       GET REFRESH TOKEN SECRET
    ====================================================== */

    const secret =
      process.env.JWT_REFRESH_SECRET;

    if (!secret) {
      throw new Error(
        "JWT_REFRESH_SECRET is missing."
      );
    }

    /* =====================================================
       VERIFY REFRESH TOKEN
    ====================================================== */

    const payload =
      jwt.verify(
        refreshToken,
        secret
      ) as jwt.JwtPayload;

    /* =====================================================
       VALIDATE TOKEN
    ====================================================== */

    if (
      payload.type !== "refresh" ||
      !payload.sub
    ) {
      return response.status(401).json({
        code: "INVALID_REFRESH_TOKEN",
        message:
          "Invalid refresh token.",
      });
    }

    /* =====================================================
       FIND USER
    ====================================================== */

    const user =
      await User.findById(
        payload.sub
      );

    if (
      !user ||
      !user.refreshTokenHash
    ) {
      return response.status(401).json({
        code: "INVALID_REFRESH_TOKEN",
        message:
          "Refresh token is invalid.",
      });
    }

    /* =====================================================
       COMPARE STORED REFRESH TOKEN HASH
    ====================================================== */

    const incomingRefreshTokenHash =
      hashValue(refreshToken);

    if (
      user.refreshTokenHash !==
      incomingRefreshTokenHash
    ) {
      clearAuthCookies(response);

      return response.status(401).json({
        code: "INVALID_REFRESH_TOKEN",
        message:
          "Refresh token is invalid.",
      });
    }

    /* =====================================================
       PRESERVE REMEMBER ME
       -----------------------------------------------------
       This value was stored inside the refresh JWT when
       the user originally logged in.
    ====================================================== */

    const rememberMe =
      payload.rememberMe === true;

    /* =====================================================
       CREATE NEW ACCESS + REFRESH TOKENS
       -----------------------------------------------------
       If Remember Me was true:
           new refresh token = 30 days

       If Remember Me was false:
           new refresh token = configured duration,
           normally 7 days
    ====================================================== */

    await issueLoginTokens(
      user,
      response,
      rememberMe
    );

    /* =====================================================
       RESPONSE
    ====================================================== */

    return response.json({
      message:
        "Access token refreshed.",
    });
  } catch (error) {
    console.error(
      "refreshAccessToken:",
      error
    );

    clearAuthCookies(response);

    return response.status(401).json({
      code: "SESSION_EXPIRED",
      message:
        "Session expired. Please sign in again.",
    });
  }
};

export const checkSession = async (
  request: Request,
  response: Response
) => {
  const accessToken = request.cookies?.[getAccessTokenCookieName()];
  const refreshToken = request.cookies?.[getRefreshTokenCookieName()];

  try {
    const accessSecret = process.env.JWT_ACCESS_SECRET;
    if (!accessSecret) throw new Error("JWT_ACCESS_SECRET is missing.");

    if (accessToken) {
      try {
        const payload = jwt.verify(accessToken, accessSecret) as jwt.JwtPayload;
        if (payload.type === "access" && typeof payload.sub === "string") {
          const user = await User.findById(payload.sub);
          if (user) return response.json({ authenticated: true });
        }
      } catch (error) {
        if (!(error instanceof jwt.TokenExpiredError) && !(error instanceof jwt.JsonWebTokenError)) {
          throw error;
        }
      }
    }

    if (!refreshToken) {
      clearAuthCookies(response);
      return response.json({ authenticated: false });
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!refreshSecret) throw new Error("JWT_REFRESH_SECRET is missing.");

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(refreshToken, refreshSecret) as jwt.JwtPayload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError || error instanceof jwt.JsonWebTokenError) {
        clearAuthCookies(response);
        return response.json({ authenticated: false });
      }
      throw error;
    }

    if (payload.type !== "refresh" || typeof payload.sub !== "string") {
      clearAuthCookies(response);
      return response.json({ authenticated: false });
    }

    const user = await User.findById(payload.sub);
    if (!user?.refreshTokenHash || user.refreshTokenHash !== hashValue(refreshToken)) {
      clearAuthCookies(response);
      return response.json({ authenticated: false });
    }

    await issueLoginTokens(user, response, payload.rememberMe === true);
    return response.json({ authenticated: true });
  } catch (error) {
    console.error("checkSession:", error);
    return response.status(500).json({
      message: "Unable to verify your session.",
    });
  }
};

export const logout = async (
  request: Request,
  response: Response
) => {
  try {
    const refreshToken = request.cookies?.[getRefreshTokenCookieName()];
    const accessToken = request.cookies?.[getAccessTokenCookieName()];
    let userId: string | undefined;

    if (refreshToken && process.env.JWT_REFRESH_SECRET) {
      try {
        const payload = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        ) as jwt.JwtPayload;
        if (payload.type === "refresh" && typeof payload.sub === "string") {
          userId = payload.sub;
        }
      } catch {
        // An expired refresh token can still be revoked using the access cookie.
      }
    }

    if (!userId && accessToken && process.env.JWT_ACCESS_SECRET) {
      try {
        const payload = jwt.verify(
          accessToken,
          process.env.JWT_ACCESS_SECRET
        ) as jwt.JwtPayload;
        if (payload.type === "access" && typeof payload.sub === "string") {
          userId = payload.sub;
        }
      } catch {
        // Invalid or expired cookies are still cleared below.
      }
    }

    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshTokenHash: null });
    }

    clearAuthCookies(response);

    return response.json({
      message:
        "Logged out successfully.",
    });
  } catch (error) {
    console.error("Logout failed while revoking the session:", error);
    return response.status(500).json({
        message: "Unable to revoke the session. Please try again.",
    });
  }
};

export const getCurrentUser = async (
  request: AuthenticatedRequest,
  response: Response
) => {
  try {
    if (!request.userId) {
      return response.status(401).json({
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      });
    }

    const user = await User.findById(
      request.userId
    ).select(
      "-passwordHash -refreshTokenHash"
    );

    if (!user) {
      return response.status(404).json({
        code: "USER_NOT_FOUND",
        message: "User not found.",
      });
    }

    return response.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profilePhoto: user.profilePhoto,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "getCurrentUser:",
      error
    );

    return response.status(500).json({
      message:
        "Unable to fetch current user.",
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
    /* =====================================================
       GET GOOGLE CALLBACK PARAMETERS
    ====================================================== */

    const code = String(
      request.query.code || ""
    );

    const receivedState = String(
      request.query.state || ""
    );

    /* =====================================================
       GET STORED OAUTH STATE
    ====================================================== */

    const storedState =
      request.cookies?.jobdrips_google_state;

    /* =====================================================
       CLEAR GOOGLE STATE COOKIE
    ====================================================== */

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

    /* =====================================================
       VALIDATE GOOGLE CALLBACK
    ====================================================== */

    if (
      !code ||
      !receivedState ||
      !storedState ||
      receivedState !== storedState
    ) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=state`
      );
    }

    /* =====================================================
       CREATE GOOGLE CLIENT
    ====================================================== */

    const client =
      getGoogleClient();

    /* =====================================================
       EXCHANGE AUTHORIZATION CODE
       FOR GOOGLE TOKENS
    ====================================================== */

    const { tokens } =
      await client.getToken(code);

    if (!tokens.id_token) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=identity`
      );
    }

    /* =====================================================
       GOOGLE CLIENT ID
    ====================================================== */

    const googleClientId =
      process.env.GOOGLE_CLIENT_ID;

    if (!googleClientId) {
      throw new Error(
        "GOOGLE_CLIENT_ID is missing."
      );
    }

    /* =====================================================
       VERIFY GOOGLE ID TOKEN
    ====================================================== */

    const ticket =
      await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: googleClientId,
      });

    const payload =
      ticket.getPayload();

    /* =====================================================
       VALIDATE GOOGLE USER INFORMATION
    ====================================================== */

    if (
      !payload ||
      !payload.email ||
      !payload.sub
    ) {
      return response.redirect(
        `${CLIENT_URL}/?googleError=identity`
      );
    }

    /* =====================================================
       NORMALIZE EMAIL
    ====================================================== */

    const email =
      normalizeEmail(
        payload.email
      );

    /* =====================================================
       FIND EXISTING USER
    ====================================================== */

    let user =
      await User.findOne({
        email,
      });

    /* =====================================================
       CREATE USER IF IT DOES NOT EXIST
    ====================================================== */

    if (!user) {
      user =
        await User.create({
          email,

          googleId:
            payload.sub,

          name:
            payload.name || "",

          profilePhoto:
            payload.picture || "",

          passwordHash: null,
        });
    } else {
      /* ===================================================
         EXISTING USER
      ================================================== */

      if (!user.googleId) {
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

    /* =====================================================
       CREATE JOBDRIPS JWT TOKENS
       AND SEND THEM AS HTTP-ONLY COOKIES
    ====================================================== */

    await issueLoginTokens(
      user,
      response,
      false
    );

    /* =====================================================
       GOOGLE LOGIN SUCCESS
       -----------------------------------------------
       IMPORTANT:
       Directly open the authenticated profile page.
    ====================================================== */

    return response.redirect(
      `${CLIENT_URL}/profile`
    );
  } catch (error) {
    console.error(
      "googleCallback:",
      error
    );

    /* =====================================================
       GOOGLE LOGIN FAILURE
    ====================================================== */

    return response.redirect(
      `${CLIENT_URL}/?googleError=failed`
    );
  }
};

const cryptoRandomState = () =>
  crypto.randomBytes(32).toString("hex");
