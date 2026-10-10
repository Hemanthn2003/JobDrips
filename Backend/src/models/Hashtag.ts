
import mongoose, { Schema } from "mongoose";

const hashtagSchema = new Schema(
  {
    hashtagId: {
      type: String,
      required: true,
      unique: true,
    },
    hashtag: {
      type: String,
      required: true,
      trim: true,
    },
    usesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    versionKey: false,
  }
);

const Hashtag =
  (mongoose.models.Hashtag as mongoose.Model<any>) ||
  mongoose.model("Hashtag", hashtagSchema, "hashtags");

export default Hashtag;
