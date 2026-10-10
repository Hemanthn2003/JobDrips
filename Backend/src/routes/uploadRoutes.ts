
import { Router } from "express";
import multer from "multer";
import { authenticate } from "../utils/authMiddleware.js";
import { uploadImage } from "../controllers/uploadController.js";

const router = Router();

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(
        new Error("Only JPEG, PNG, and WebP images are allowed.")
      );
      return;
    }

    callback(null, true);
  },
});

router.post(
  "/image",
  authenticate,
  (request, response, next) => {
   upload.single("image")(request, response, (error) => {
  console.log("Content-Type:", request.headers["content-type"]);
  console.log("Multer error:", error ?? "none");
  console.log("Received file:", request.file);

  if (!error) {
    next();
    return;
  }
      if (error instanceof multer.MulterError) {
        const isTooLarge = error.code === "LIMIT_FILE_SIZE";

        response.status(isTooLarge ? 413 : 400).json({
          success: false,
          message: isTooLarge
            ? "Image must be 5 MB or smaller."
            : "Invalid image upload.",
        });
        return;
      }

      response.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Invalid image upload.",
      });
    });
  },
  uploadImage
);

export default router;
