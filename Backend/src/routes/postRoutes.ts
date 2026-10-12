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
} from "../controllers/postController.js";

import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Friends for the share sheet and @mention suggestions
router.get("/friends", authenticate, listFriendsForPicker);

// One post
router.get("/:ownerId/:postId", authenticate, getPost);
router.patch("/:ownerId/:postId", authenticate, updatePost);
router.delete("/:ownerId/:postId", authenticate, deletePost);

// Post actions
router.post("/:ownerId/:postId/like", authenticate, setPostLike);
router.post("/:ownerId/:postId/save", authenticate, setPostSave);
router.post("/:ownerId/:postId/share", authenticate, sharePost);
router.post("/:ownerId/:postId/archive", authenticate, archivePost);
router.post("/:ownerId/:postId/report", authenticate, reportPost);

// Comments
router.post("/:ownerId/:postId/comments", authenticate, addComment);
router.patch("/:ownerId/:postId/comments/:commentId", authenticate, editComment);
router.delete("/:ownerId/:postId/comments/:commentId", authenticate, deleteComment);
router.post(
  "/:ownerId/:postId/comments/:commentId/like",
  authenticate,
  setCommentLike,
);

export default router;
