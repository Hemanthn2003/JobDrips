import mongoose, { Schema } from "mongoose";

// One document per person who reports a post.
const reportSchema = new Schema(
  {
    reportId: { type: String, required: true, unique: true },
    postId: { type: String, required: true, index: true },
    postOwnerId: { type: String, required: true, index: true },
    reportedByUserId: { type: String, required: true, index: true },
    reason: { type: String, required: true, maxlength: 2000 },
    // Copy of the post at the time it was reported.
    postSnapshot: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["open", "reviewed", "dismissed"],
      default: "open",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

reportSchema.index({ postId: 1, reportedByUserId: 1 });

const Report =
  (mongoose.models.Report as mongoose.Model<any>) ||
  mongoose.model("Report", reportSchema, "reports");

export default Report;
