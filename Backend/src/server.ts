
import "dotenv/config";

import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import Profile from "./models/Profile.js";

const PORT = Number(process.env.PORT) || 5000;

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

    app.listen(PORT, () => {
      console.log(
        `JobDrips backend running at http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Failed to start JobDrips backend:",
      error
    );

    process.exit(1);
  }
};

startServer();
