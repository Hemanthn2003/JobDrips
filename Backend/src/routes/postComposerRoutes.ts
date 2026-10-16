import { Router } from "express";
import { authenticate } from "../utils/authMiddleware.js"; // ← your middleware file's real name
import { postMediaUpload } from "../middleware/postMediaUpload.js";
import {
  createPost,
  getComposerContext,
  searchHashtags,
  searchMentions,
} from "../controllers/NewpostController.js";
import { emitPostChange } from "../utils/liveEvents.js";

const router = Router();

router.use(authenticate);

router.get("/context", getComposerContext); // name + avatar for the composer header
router.get("/hashtags", searchHashtags); //   ?q=jo   → hashtags containing "jo", most used first
router.get("/mentions", searchMentions); //   ?q=sam  → friends whose username contains "sam"
router.post("/", postMediaUpload, emitPostChange, createPost); // multipart: caption, images[], video, poll, ...

export default router;
