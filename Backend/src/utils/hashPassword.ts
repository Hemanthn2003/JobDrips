import bcrypt from "bcryptjs";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question("Enter password to hash: ", async (password) => {
  try {
    if (!password) {
      console.log("Password cannot be empty.");
      rl.close();
      return;
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    console.log("\nHashed password:");
    console.log(hashedPassword);

    rl.close();
  } catch (error) {
    console.error("Error hashing password:", error);
    rl.close();
  }
});