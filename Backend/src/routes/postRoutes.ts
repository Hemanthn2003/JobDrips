import { Router } from "express";

import {
  addComment,
  archivePost,
  deleteComment,
  deletePost,
  editComment,
  getPost,
  listFriendsForPicker,
  reportPost,
  setCommentLike,
  setPostLike,
  setPostSave,
  sharePost,
  updatePost,
  voteOnPoll,
} from "../controllers/postController.js";

import { authenticate } from "../utils/authMiddleware.js";
import { emitPostChange } from "../utils/liveEvents.js";

const router = Router();

// Friends for the share sheet and @mention suggestions
router.get("/friends", authenticate, listFriendsForPicker);

// One post
router.get("/:ownerId/:postId", authenticate, getPost);
router.patch("/:ownerId/:postId", authenticate, emitPostChange, updatePost);
router.delete("/:ownerId/:postId", authenticate, emitPostChange, deletePost);

// Post actions (every successful one broadcasts "post:updated")
router.post("/:ownerId/:postId/like", authenticate, emitPostChange, setPostLike);
router.post("/:ownerId/:postId/save", authenticate, emitPostChange, setPostSave);
router.post("/:ownerId/:postId/share", authenticate, emitPostChange, sharePost);
router.post("/:ownerId/:postId/poll/vote", authenticate, emitPostChange, voteOnPoll);
router.post("/:ownerId/:postId/archive", authenticate, emitPostChange, archivePost);
router.post("/:ownerId/:postId/report", authenticate, reportPost);

// Comments
router.post("/:ownerId/:postId/comments", authenticate, emitPostChange, addComment);
router.patch("/:ownerId/:postId/comments/:commentId", authenticate, emitPostChange, editComment);
router.delete("/:ownerId/:postId/comments/:commentId", authenticate, emitPostChange, deleteComment);
router.post(
  "/:ownerId/:postId/comments/:commentId/like",
  authenticate,
  emitPostChange,
  setCommentLike,
);

export default router;