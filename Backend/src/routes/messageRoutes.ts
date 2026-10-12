import { Router } from "express";
import { sendMessage } from "../controllers/messageController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Demo messaging: stores the message in the "messages" collection.
router.post("/send", authenticate, sendMessage);

export default router;
