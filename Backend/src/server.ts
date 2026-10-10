
import "dotenv/config";

import app from "./app.js";
import { connectDatabase } from "./config/db.js";

const PORT = Number(process.env.PORT) || 5000;

const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB before accepting requests.
    await connectDatabase();

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
