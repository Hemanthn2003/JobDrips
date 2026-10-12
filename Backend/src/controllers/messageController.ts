import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";

import Message from "../models/Message.js";
import Profile from "../models/Profile.js";
import type { AuthenticatedRequest } from "../utils/authMiddleware.js";
import { acceptedFriendIds } from "../utils/postHelpers.js";

export const conversationIdFor = (a: string, b: string): string =>
  [a, b].sort().join(":");

interface NewMessage {
  senderUserId: string;
  recipientUserId: string;
  text?: string;
  kind?: "text" | "post_share" | "mention";
  sharedPostId?: string | null;
  sharedPostOwnerId?: string | null;
}

/** Demo messaging: stores the message so it can be read later. */
export const createMessage = (input: NewMessage) =>
  Message.create({
    messageId: randomUUID(),
    conversationId: conversationIdFor(
      input.senderUserId,
      input.recipientUserId,
    ),
    senderUserId: input.senderUserId,
    recipientUserId: input.recipientUserId,
    text: (input.text ?? "").slice(0, 5000),
    kind: input.kind ?? "text",
    sharedPostId: input.sharedPostId ?? null,
    sharedPostOwnerId: input.sharedPostOwnerId ?? null,
  });

// --------------------------------------------------
// SEND A MESSAGE (demo)
// POST /api/messages/send
// Body: { recipientUserId, text?, sharedPostId?, sharedPostOwnerId? }
// --------------------------------------------------

export const sendMessage = async (
  request: Request,
  response: Response,
): Promise<void> => {
  try {
    const senderId = String((request as AuthenticatedRequest).userId || "");

    if (!senderId) {
      response.status(401).json({
        success: false,
        message: "Authentication required.",
      });
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const recipientId =
      typeof body.recipientUserId === "string" ? body.recipientUserId : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const sharedPostId =
      typeof body.sharedPostId === "string" ? body.sharedPostId : null;
    const sharedPostOwnerId =
      typeof body.sharedPostOwnerId === "string" ? body.sharedPostOwnerId : null;

    if (!recipientId || recipientId === senderId) {
      response.status(400).json({
        success: false,
        message: "Choose someone else to message.",
      });
      return;
    }

    if (!text && !sharedPostId) {
      response.status(400).json({
        success: false,
        message: "Write a message first.",
      });
      return;
    }

    if (text.length > 2000) {
      response.status(400).json({
        success: false,
        message: "Messages can be up to 2000 characters.",
      });
      return;
    }

    const sender = await Profile.findOne({ userid: senderId })
      .select("friends")
      .lean();

    if (!acceptedFriendIds(sender).includes(recipientId)) {
      response.status(403).json({
        success: false,
        message: "You can only message your friends.",
      });
      return;
    }

    const message = await createMessage({
      senderUserId: senderId,
      recipientUserId: recipientId,
      text,
      kind: sharedPostId ? "post_share" : "text",
      sharedPostId,
      sharedPostOwnerId,
    });

    response.status(201).json({
      success: true,
      data: { messageId: message.messageId },
    });
  } catch (error) {
    console.error("Send message failed:", error);
    response.status(500).json({
      success: false,
      message: "Unable to send the message.",
    });
  }
};
