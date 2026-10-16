import { Router } from "express";
import { searchAll, suggestAll } from "../controllers/searchController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = Router();

// Dropdown suggestions while typing (small, fast): people + posts
//   1-2 letters -> friends only, 3+ letters -> everybody
router.get("/suggest", authenticate, suggestAll);

// Full results page: people + posts
router.get("/", authenticate, searchAll);

export default router;