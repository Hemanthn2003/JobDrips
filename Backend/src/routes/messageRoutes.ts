import { Router } from "express";
import {
  getConversation,
  sendMessage,
} from "../controllers/messageController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Demo messaging: stores the message in the "messages" collection.
router.post("/send", authenticate, sendMessage);

// Full chat history (both sides) between me and one friend.
router.get("/conversation/:userid", authenticate, getConversation);

export default router;
