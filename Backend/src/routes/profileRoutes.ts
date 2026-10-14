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
import { authenticate, type AuthenticatedRequest } from "../utils/authMiddleware.js";
import Profile from "../models/Profile.js";
import { emitToUser } from "../utils/realtime.js";

const router = Router();

// Emit a live invalidation after existing story handlers finish successfully.
// Payloads contain no private story data; clients reload through authenticated APIs.
const emitStoryChangeAfterSuccess = (req: any, res: any, next: any) => {
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    void (async () => {
      const actorId = String((req as AuthenticatedRequest).userId || "");
      const ownerId = String(req.params.userid || actorId);
      if (!ownerId) return;
      const owner = await Profile.findOne({ userid: ownerId }).select("userid friends").lean() as any;
      if (!owner) return;
      const payload = { ownerUserId: ownerId, storyId: String(req.params.storyId || ""), action: req.method.toLowerCase(), at: new Date().toISOString() };
      emitToUser(ownerId, "story:updated", payload);
      for (const friend of owner.friends || []) {
        if (friend.friendshipAccepted === true && friend.userid) emitToUser(String(friend.userid), "story:updated", payload);
      }
    })().catch((error) => console.error("Unable to broadcast story update:", error));
  });
  next();
};

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
router.delete("/:userid/friend-request", authenticate, withdrawFriendRequest);

// Remove an accepted friend (removes it on both profiles)
router.delete("/friends/:userid", authenticate, removeFriend);

// Stories
router.post("/me/stories", authenticate, emitStoryChangeAfterSuccess, createStory);
router.delete("/me/stories/:storyId", authenticate, emitStoryChangeAfterSuccess, deleteStory);
router.get("/:userid/stories", authenticate, getStories);
router.post("/:userid/stories/:storyId/view", authenticate, emitStoryChangeAfterSuccess, viewStory);
router.get("/:userid/stories/:storyId/interactions", authenticate, getStoryInteractions);
router.post("/:userid/stories/:storyId/like", authenticate, toggleStoryLike);
router.post("/:userid/stories/:storyId/reply", authenticate, replyToStory);

// Keep the general profile route last.
// CHANGED: now authenticated, otherwise the controller can never tell who is
// looking, so private-profile friend checks and "seen" flags would not work.
router.get("/:userid", authenticate, getPublicProfile);

export default router;
