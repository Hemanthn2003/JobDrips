import { Router } from "express";
import { getFeed } from "../controllers/feedController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

router.get("/", authenticate, getFeed);

export default router;