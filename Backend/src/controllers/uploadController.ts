
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import type { UploadApiResponse } from "cloudinary";
import cloudinary from "../config/cloudinary.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";

const uploadImage = async (
  request: Request,
  response: Response
): Promise<void> => {
  const authenticatedRequest =
    request as AuthenticatedRequest;

  try {
    if (!authenticatedRequest.userId) {
      response.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!request.file) {
      response.status(400).json({
        success: false,
        message: "Please select an image to upload.",
      });
      return;
    }

    const result = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: `jobdrips/users/${authenticatedRequest.userId}/images`,
            resource_type: "image",
          },
          (error, uploadResult) => {
            if (error) {
              reject(error);
              return;
            }

            if (!uploadResult) {
              reject(
                new Error(
                  "Cloudinary returned no upload result."
                )
              );
              return;
            }

            resolve(uploadResult);
          }
        );

        stream.end(request.file!.buffer);
      }
    );

    response.status(201).json({
      success: true,
      message: "Image uploaded successfully.",
      data: {
        secureUrl: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        bytes: result.bytes,
      },
    });
  } catch (error: unknown) {
    console.error("Cloudinary image upload failed:", error);

    const isDevelopment =
      process.env.NODE_ENV !== "production";

    response.status(502).json({
      success: false,
      message: "Image upload failed. Please try again.",
      ...(isDevelopment && {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
    });
  }
};

// --------------------------------------------------
// STORY VIDEO UPLOAD
// POST /api/uploads/video   (multipart: video, optional start / end in seconds)
// The original is uploaded in chunks; Cloudinary transcodes the selected range
// (max 60 s) to a compressed MP4 before the story is published.
// --------------------------------------------------

const MAX_STORY_VIDEO_SECONDS = 60;

const asSeconds = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const uploadVideo = async (
  request: Request,
  response: Response
): Promise<void> => {
  const authenticatedRequest =
    request as AuthenticatedRequest;

  try {
    if (!authenticatedRequest.userId) {
      response.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    if (!request.file) {
      response.status(400).json({
        success: false,
        message: "Please select a video to upload.",
      });
      return;
    }

    const requestedStart = asSeconds(request.body?.start);
    const requestedEnd = asSeconds(request.body?.end);
    const hasTrim = requestedStart !== null || requestedEnd !== null;

    const start = requestedStart ?? 0;
    let end = requestedEnd ?? start + MAX_STORY_VIDEO_SECONDS;
    if (end <= start) end = start + MAX_STORY_VIDEO_SECONDS;
    if (end - start > MAX_STORY_VIDEO_SECONDS) {
      end = start + MAX_STORY_VIDEO_SECONDS;
    }

    const file = request.file;
    const result = await new Promise<UploadApiResponse>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_chunked_stream(
          {
            folder: `jobdrips/users/${authenticatedRequest.userId}/stories`,
            resource_type: "video",
            chunk_size: 20 * 1024 * 1024,
            timeout: 600000,
            ...(hasTrim && {
              // Return a compressed, browser-compatible clip instead of the original.
              eager: [
                {
                  start_offset: start.toFixed(2),
                  end_offset: end.toFixed(2),
                  format: "mp4",
                  video_codec: "h264",
                  quality: "auto:good",
                },
              ],
              eager_async: false,
            }),
          },
          (error, uploadResult) => {
            if (error) {
              reject(error);
              return;
            }

            if (!uploadResult) {
              reject(
                new Error(
                  "Cloudinary returned no upload result."
                )
              );
              return;
            }

            resolve(uploadResult);
          }
        );

        const source = createReadStream(file.path);
        source.on("error", reject);
        stream.on("error", reject);
        source.pipe(stream);
      }
    );

    const total = Number(result.duration) || 0;
    let secureUrl = result.secure_url;
    let duration = total;

    if (hasTrim) {
      const eagerUrl: unknown = result.eager?.[0]?.secure_url;
      const stop = total > 0 ? Math.min(end, total) : end;
      duration = Math.max(0, stop - Math.min(start, stop));

      secureUrl =
        typeof eagerUrl === "string" && eagerUrl
          ? eagerUrl
          : secureUrl.replace(
              "/video/upload/",
              `/video/upload/so_${start.toFixed(2)},eo_${end.toFixed(2)}/`
            );
    } else if (total > MAX_STORY_VIDEO_SECONDS) {
      // Safety net: a story video is never longer than 60 seconds.
      duration = MAX_STORY_VIDEO_SECONDS;
      secureUrl = secureUrl.replace(
        "/video/upload/",
        `/video/upload/so_0,eo_${MAX_STORY_VIDEO_SECONDS}/`
      );
    }

    // Always deliver an MP4 so every browser can play it.
    secureUrl = secureUrl.replace(/\.[a-z0-9]+(?:\?.*)?$/i, ".mp4");

    response.status(201).json({
      success: true,
      message: "Video uploaded successfully.",
      data: {
        secureUrl,
        publicId: result.public_id,
        format: "mp4",
        bytes: result.bytes,
        duration: Number(duration.toFixed(2)),
      },
    });
  } catch (error: unknown) {
    console.error("Cloudinary video upload failed:", error);

    const isDevelopment =
      process.env.NODE_ENV !== "production";

    response.status(502).json({
      success: false,
      message: "Video upload failed. Please try again.",
      ...(isDevelopment && {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
    });
  } finally {
    if (request.file?.path) {
      try {
        await unlink(request.file.path);
      } catch (error) {
        console.error("Failed to remove temporary story video:", error);
      }
    }
  }
};

export { uploadImage, uploadVideo };
