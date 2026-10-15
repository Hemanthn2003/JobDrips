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
  getStoryInteractions,
  replyToStory,
  toggleStoryLike,
  updateMyProfile,
  updateProfileImage,
  viewStory,
  sendFriendRequest,
  withdrawFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
} from "../controllers/profileController.js";

import { removeFriend } from "../controllers/friendController.js";
import { authenticate } from "../utils/authMiddleware.js";
import { emitFriendChange, emitStoryChange } from "../utils/liveEvents.js";

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

// Friend requests (live: both people + notification badge update instantly)
router.post("/requests/:requesterId/accept", authenticate, emitFriendChange, acceptFriendRequest);
router.post("/requests/:requesterId/decline", authenticate, emitFriendChange, declineFriendRequest);
router.post("/:userid/friend-request", authenticate, emitFriendChange, sendFriendRequest);
router.delete("/:userid/friend-request", authenticate, emitFriendChange, withdrawFriendRequest);

// Remove an accepted friend (removes it on both profiles)
router.delete("/friends/:userid", authenticate, emitFriendChange, removeFriend);

// Stories (like and reply broadcast from their controllers)
router.post("/me/stories", authenticate, emitStoryChange, createStory);
router.delete("/me/stories/:storyId", authenticate, emitStoryChange, deleteStory);
router.get("/:userid/stories", authenticate, getStories);
router.post("/:userid/stories/:storyId/view", authenticate, emitStoryChange, viewStory);
router.get("/:userid/stories/:storyId/interactions", authenticate, getStoryInteractions);
router.post("/:userid/stories/:storyId/like", authenticate, toggleStoryLike);
router.post("/:userid/stories/:storyId/reply", authenticate, replyToStory);

// Keep the general profile route last.
router.get("/:userid", authenticate, getPublicProfile);

export default router;