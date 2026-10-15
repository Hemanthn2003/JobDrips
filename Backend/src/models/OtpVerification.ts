import mongoose, { Schema, type InferSchemaType } from "mongoose";

const otpVerificationSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    purpose: {
      type: String,
      required: true,
      enum: ["SIGNUP", "RESET_PASSWORD"],
      index: true,
    },

    otpHash: {
      type: String,
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },

    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

otpVerificationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export type OtpVerificationDocument =
  InferSchemaType<typeof otpVerificationSchema> & {
    _id: mongoose.Types.ObjectId;
  };

export const OtpVerification = mongoose.model(
  "OtpVerification",
  otpVerificationSchema
);
