import { Router } from "express";

import {
  googleCallback,
  googleLogin,
  login,
  logout,
  refreshAccessToken,
  requestResetOtp,
  requestSignupOtp,
  resetPassword,
  signup,
  verifyResetOtp,
  verifySignupOtp,
} from "../controllers/authController.js";

const router = Router();

router.post(
  "/signup/request-otp",
  requestSignupOtp
);

router.post(
  "/signup/verify-otp",
  verifySignupOtp
);

router.post(
  "/signup",
  signup
);

router.post(
  "/login",
  login
);

router.post(
  "/forgot-password/request-otp",
  requestResetOtp
);

router.post(
  "/forgot-password/verify-otp",
  verifyResetOtp
);

router.post(
  "/forgot-password/reset",
  resetPassword
);

router.post(
  "/refresh",
  refreshAccessToken
);

router.post(
  "/logout",
  logout
);

router.get(
  "/google",
  googleLogin
);

router.get(
  "/google/callback",
  googleCallback
);

export default router;
