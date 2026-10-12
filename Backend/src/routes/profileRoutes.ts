import { Router } from "express";

import {
  addEducation,
  addExperience,
  checkUsernameAvailability,
  createStory,
  deleteEducation,
  deleteExperience,
  deleteStory,
  getMyProfile,
  getPublicProfile,
  getStories,
  updateMyProfile,
  updateProfileImage,
  viewStory,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from "../controllers/profileController.js";

import { removeFriend } from "../controllers/friendController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Current user's profile
router.get("/me", authenticate, getMyProfile);
router.patch("/me", authenticate, updateMyProfile);
router.patch("/me/image", authenticate, updateProfileImage);

// Username availability (must stay above "/:userid")
router.get("/username-availability", authenticate, checkUsernameAvailability);

// Education
router.post("/me/education", authenticate, addEducation);
router.delete("/me/education/:id", authenticate, deleteEducation);

// Experience
router.post("/me/experience", authenticate, addExperience);
router.delete("/me/experience/:id", authenticate, deleteExperience);

// Friend requests
router.post("/requests/:requesterId/accept", authenticate, acceptFriendRequest);
router.post("/requests/:requesterId/decline", authenticate, declineFriendRequest);
router.post("/:userid/friend-request", authenticate, sendFriendRequest);

// Remove an accepted friend (removes it on both profiles)
router.delete("/friends/:userid", authenticate, removeFriend);

// Stories
router.post("/me/stories", authenticate, createStory);
router.delete("/me/stories/:storyId", authenticate, deleteStory);
router.get("/:userid/stories", authenticate, getStories);
router.post("/:userid/stories/:storyId/view", authenticate, viewStory);

// Keep the general profile route last.
// CHANGED: now authenticated, otherwise the controller can never tell who is
// looking, so private-profile friend checks and "seen" flags would not work.
router.get("/:userid", authenticate, getPublicProfile);

export default router;
