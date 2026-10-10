
import type { Request, Response } from "express";
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

export { uploadImage };
