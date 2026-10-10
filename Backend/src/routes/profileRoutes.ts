
import { Router } from "express";

import {
  addEducation,
  addExperience,
  deleteEducation,
  deleteExperience,
  getMyProfile,
  getPublicProfile,
  updateMyProfile,
  updateProfileImage,
} from "../controllers/profileController.js";

import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Current user's profile
router.get("/me", authenticate, getMyProfile);
router.patch("/me", authenticate, updateMyProfile);
router.patch("/me/image", authenticate, updateProfileImage);

// Education
router.post("/me/education", authenticate, addEducation);
router.delete("/me/education/:id", authenticate, deleteEducation);

// Experience
router.post("/me/experience", authenticate, addExperience);
router.delete("/me/experience/:id", authenticate, deleteExperience);

// Another user's profile.
// Keep this route after the explicit /me routes.
router.get("/:userid", getPublicProfile);

export default router;
