import "dotenv/config";
import { createServer } from "node:http";
import { attachRealtime } from "./utils/realtime.js";

import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import Profile from "./models/Profile.js";
import Conversation from "./models/Conversation.js";

const PORT = Number(process.env.PORT) || 5000;
const httpServer = createServer(app);
attachRealtime(httpServer);

const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB before accepting requests.
    await connectDatabase();

    // One-time cleanup: friend requests used to leave a "pending" entry in the
    // sender's friends list. Requests now only live in the receiver's list.
    const cleaned = await Profile.updateMany(
      { "friends.friendshipAccepted": false },
      { $pull: { friends: { friendshipAccepted: false } } },
    );

    if (cleaned.modifiedCount > 0) {
      console.log(
        `Removed pending friend entries from ${cleaned.modifiedCount} profile(s).`,
      );
    }

    // Conversations only have two types now: "personal" and "group".
    // Older documents used "direct"; convert them (safe to run on every start).
    const converted = await Conversation.updateMany(
      { type: "direct" },
      { $set: { type: "personal" } },
    );

    if (converted.modifiedCount > 0) {
      console.log(
        `Converted ${converted.modifiedCount} conversation(s) from "direct" to "personal".`,
      );
    }

    // httpServer (not app.listen) so Socket.IO is actually served.
    httpServer.listen(PORT, () => {
      console.log(`JobDrips backend running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start JobDrips backend:", error);
    process.exit(1);
  }
};

startServer();