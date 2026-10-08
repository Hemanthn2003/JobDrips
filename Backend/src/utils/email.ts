import nodemailer from "nodemailer";

const getRequiredEnv = (name: string) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing in Backend/.env`);
  }

  return value;
};

const transporter = nodemailer.createTransport({
  host: getRequiredEnv("SMTP_HOST"),
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: getRequiredEnv("SMTP_USER"),
    pass: getRequiredEnv("SMTP_PASS"),
  },
});

export const sendOtpEmail = async (
  email: string,
  otp: string,
  purpose: "SIGNUP" | "RESET_PASSWORD"
) => {
  const isSignup = purpose === "SIGNUP";

  await transporter.sendMail({
    from: getRequiredEnv("SMTP_FROM"),
    to: email,
    subject: isSignup
      ? "Your JobDrips verification OTP"
      : "Your JobDrips password reset OTP",
    text: isSignup
      ? `Your JobDrips verification OTP is ${otp}. It expires in 10 minutes.`
      : `Your JobDrips password reset OTP is ${otp}. It expires in 10 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:30px;color:#2B1F1A">
        <h2 style="color:#8F4C32">JobDrips</h2>
        <p>Your verification code is:</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#B76E4D">
          ${otp}
        </div>
        <p>This OTP expires in 10 minutes.</p>
        <p>If you did not request this code, you can safely ignore this email.</p>
      </div>
    `,
  });
};
