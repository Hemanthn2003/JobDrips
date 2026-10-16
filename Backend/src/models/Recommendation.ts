import mongoose, { Schema } from "mongoose";

export const RECOMMENDATION_ACTIONS = [
  "pending", // shown in the list, nothing done yet
  "added", // a friend request was sent (or they are already a friend)
  "skipped", // the user pressed X
  "unseen", // never opened within 7 days of recommendedOn
] as const;

export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

// One person that was recommended to the owner of the document.
const entrySchema = new Schema(
  {
    userid: { type: String, required: true },
    action: {
      type: String,
      enum: RECOMMENDATION_ACTIONS,
      default: "pending",
    },
    recommendedOn: { type: Date, default: Date.now },
    // Set the first time the owner opens this person's profile from the list.
    seenAt: { type: Date, default: null },
    // When the owner skipped / added the person.
    actedAt: { type: Date, default: null },
    // Keyword similarity, 0-100.
    score: { type: Number, default: 0 },
    // "college" | "industry" | "nearby" (used by the filter chips).
    tags: { type: [String], default: [] },
  },
  { _id: false },
);

// One document per user: everything recommended to that user, newest first.
const recommendationSchema = new Schema(
  {
    recommendationId: { type: String, required: true, unique: true },
    // The user (profile id) these recommendations are for.
    recommendationsFor: { type: String, required: true, unique: true },
    recommendations: { type: [entrySchema], default: [] },
    lastGeneratedAt: { type: Date, default: null },
    // How many keywords the owner's own profile produced (tells the page to ask for a better profile).
    lastKeywordCount: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false },
);

const Recommendation =
  (mongoose.models.Recommendation as mongoose.Model<any>) ||
  mongoose.model("Recommendation", recommendationSchema, "recommendations");

export default Recommendation;
