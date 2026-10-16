import { Router } from "express";
import {
  listRecommendations,
  markAdded,
  markSeen,
  skipRecommendation,
} from "../controllers/recommendationController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// People You May Know
router.get("/", authenticate, listRecommendations);

// Status of one recommended person
router.post("/:userid/skip", authenticate, skipRecommendation);
router.post("/:userid/added", authenticate, markAdded);
router.post("/:userid/seen", authenticate, markSeen);

export default router;
