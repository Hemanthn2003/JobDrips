import { Router } from "express";
import {
  clearAllNotifications,
  getSummary,
  listNotifications,
  markAllRead,
} from "../controllers/notificationController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

router.get("/summary", authenticate, getSummary);
router.get("/", authenticate, listNotifications);
router.post("/read-all", authenticate, markAllRead);
router.post("/clear-all", authenticate, clearAllNotifications);

export default router;