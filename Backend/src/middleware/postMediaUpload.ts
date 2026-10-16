import multer from "multer";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB per image
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 MB per video

// Files go to the OS temp dir (NOT memory) so big videos don't eat RAM.
// The controller deletes them after the Cloudinary upload.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) =>
    cb(null, `jd-${randomUUID()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_IMAGES + 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      (file.fieldname === "images" && file.mimetype.startsWith("image/")) ||
      (file.fieldname === "video" && file.mimetype.startsWith("video/"));
    if (ok) cb(null, true);
    else cb(new Error(`Unsupported file type for "${file.fieldname}".`));
  },
});

const fields = upload.fields([
  { name: "images", maxCount: MAX_IMAGES },
  { name: "video", maxCount: 1 },
]);

/** Runs multer and turns its errors into clean JSON 400s. */
export const postMediaUpload = (req: Request, res: Response, next: NextFunction) => {
  fields(req, res, (err: unknown) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError
        ? err.code === "LIMIT_FILE_SIZE"
          ? "File is too large."
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? "Too many files, or a wrong field name."
            : err.message
        : err instanceof Error
          ? err.message
          : "Upload failed.";
    res.status(400).json({ message });
  });
};
