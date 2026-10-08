import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthModal from "../../components/auth/AuthModal";

const API_BASE_URL = "http://localhost:5000/api/auth";

/* ---------- shared style tokens ---------- */
const inputClass =
  "h-[52px] w-full rounded-[18px] border border-[#EADBD1] bg-white/75 text-[15px] font-semibold text-[var(--jd-primary-text)] outline-none placeholder:font-medium placeholder:text-[var(--jd-placeholder)] focus:border-[var(--jd-rose-gold)] focus:bg-white focus:ring-2 focus:ring-[var(--jd-rose-gold)]/20 sm:h-[56px] md:h-[60px] md:text-[16px] lg:h-[64px] lg:text-[17px] xl:h-[68px] xl:text-[18px]";
const primaryBtn =
  "flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-b from-[#CF8F70] to-[#A4543A] text-[16px] font-bold text-white shadow-[0_10px_22px_rgba(164,84,58,0.32)] transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:h-[56px] md:h-[60px] md:text-[17px] lg:h-[64px] lg:text-[18px] xl:h-[68px]";
const socialBtn =
  "flex h-[48px] w-full items-center justify-center gap-3 rounded-full border border-[#EADBD1] bg-white/85 text-[15px] font-semibold text-[var(--jd-primary-text)] shadow-sm transition-all hover:bg-white sm:h-[52px] md:h-[56px] md:text-[16px] lg:h-[60px] lg:text-[17px] xl:h-[64px]";
const cardClass =
  "relative w-full rounded-[28px] border border-white/60 bg-[#FFF8F4]/85 px-5 py-6 shadow-[0_18px_50px_rgba(75,40,25,0.22)] backdrop-blur-xl sm:px-7 sm:py-7 md:px-9 md:py-9 lg:px-11 lg:py-10 xl:px-12";
const redLink = "font-bold !text-[#C0392B] hover:!text-[#FF2414] hover:underline";
const errorText = "px-1 text-[14px] font-bold text-[#D63D2E]";
const iconWrap =
  "pointer-events-none absolute left-[16px] top-1/2 z-10 -translate-y-1/2 text-[var(--jd-icon)]";
const eyeBtn =
  "absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-[var(--jd-soft-beige)]";

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
    <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" strokeLinecap="round" />
    <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const BackLink = () => (
  <Link
    to="/"
    aria-label="Back to sign in"
    className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex h-10 w-10 items-center justify-center rounded-full text-[#7A4A38] hover:bg-white/40"
  >
    <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6" stroke="currentColor" strokeWidth="2">
      <path d="m15 5-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Link>
);

const Signup = () => {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);

  const handleGetOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/signup/request-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "USER_EXISTS") {
          setModal(true);
          return;
        }

        setError(data.message || "Unable to send OTP.");
        return;
      }

      setEmail(normalizedEmail);
      setOtp("");
      setOtpSent(true);
      setOtpVerified(false);
    } catch {
      setError(
        "Unable to connect to JobDrips server. Make sure the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (otp.trim().length !== 6) {
      setError("Enter the 6-digit OTP.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/signup/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, otp }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to verify OTP.");
        return;
      }

      setOtpVerified(true);
      setError("");
    } catch {
      setError("Unable to connect to JobDrips server.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password: newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "USER_EXISTS") {
          setModal(true);
          return;
        }

        setError(data.message || "Unable to create your account.");
        return;
      }

      navigate("/", {
        replace: true,
        state: {
          email,
          authMessage: "Account created successfully. Please sign in.",
        },
      });
    } catch {
      setError("Unable to connect to JobDrips server.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = () => {
    window.location.href = `${API_BASE_URL}/google`;
  };

  return (
    <>
      <main className="relative min-h-[100svh] w-full overflow-x-hidden bg-[var(--jd-warm-white)]">
        {/* Background */}
        <div className="fixed inset-0 z-0 h-[100svh] w-full">
          <picture className="block h-full w-full">
            <source media="(max-width: 640px)" srcSet="/assets/backgrounds/login-bg-mobile.jpg" />
            <source media="(max-width: 1024px)" srcSet="/assets/backgrounds/login-bg-tablet.jpg" />
            <img
              src="/assets/backgrounds/login-bg-desktop.jpg"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover object-center"
            />
          </picture>
          <div className="absolute inset-0 bg-[#6B402D]/[0.035]" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[540px] md:max-w-[640px] lg:max-w-[720px] xl:max-w-[780px] flex-col items-center px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pb-8">
          <BackLink />

          <div className="flex w-full flex-1 items-center justify-center py-4">
            <img
              src="/assets/logo/jobdrips-login-logo-phone-optimized.svg"
              alt="JobDrips"
              className="h-[clamp(100px,22svh,280px)] w-auto max-w-[80vw] object-contain drop-shadow-[0_7px_18px_rgba(75,40,25,0.12)]"
            />
          </div>

          <section className={cardClass}>
            <div className="mb-4 text-center sm:mb-5">
              <h1 className="text-[22px] font-extrabold tracking-[-0.02em] text-[var(--jd-primary-text)] sm:text-[25px] md:text-[28px] lg:text-[32px]">
                Create your account
              </h1>
              <p className="mt-1 text-[13px] font-medium text-[var(--jd-secondary-text)] sm:text-[15px] md:text-[16px] lg:text-[17px]">
                Join JobDrips and connect with opportunities.
              </p>
            </div>

            {!otpSent ? (
              <form onSubmit={handleGetOtp} className="space-y-3.5 sm:space-y-4 lg:space-y-5">
                <div className="relative">
                  <div className={iconWrap}>
                    <MailIcon />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email address"
                    autoComplete="email"
                    className={`${inputClass} pl-[48px] pr-3`}
                  />
                </div>

                {error ? <p className={errorText}>{error}</p> : null}

                <button type="submit" disabled={loading} className={primaryBtn}>
                  {loading ? "Sending..." : "Get OTP"}
                </button>
              </form>
            ) : !otpVerified ? (
              <form onSubmit={handleVerifyOtp} className="space-y-3.5 sm:space-y-4 lg:space-y-5">
                <input
                  type="email"
                  value={email}
                  readOnly
                  className={`${inputClass} bg-[#F3E1D7] px-4 font-bold`}
                />

                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                  placeholder="Enter OTP"
                  autoComplete="one-time-code"
                  className={`${inputClass} px-4 text-center text-[18px] font-extrabold tracking-[0.25em] placeholder:font-semibold placeholder:tracking-normal`}
                />

                {error ? <p className={errorText}>{error}</p> : null}

                <button type="submit" disabled={loading} className={primaryBtn}>
                  {loading ? "Verifying..." : "Verify OTP"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError("");
                    setOtpVerified(false);
                  }}
                  className={`mx-auto block text-[14px] ${redLink}`}
                >
                  Change email
                </button>
              </form>
            ) : (
              <form onSubmit={handleCreateAccount} className="space-y-3.5 sm:space-y-4 lg:space-y-5">
                <div className="relative">
                  <div className={iconWrap}>
                    <LockIcon />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Enter new password"
                    autoComplete="new-password"
                    className={`${inputClass} pl-[48px] pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className={eyeBtn}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    <img
                      src={showPassword ? "/assets/icons/auth/eye-off.svg" : "/assets/icons/auth/eye.svg"}
                      alt=""
                      className="h-5 w-5"
                    />
                  </button>
                </div>

                <div className="relative">
                  <div className={iconWrap}>
                    <LockIcon />
                  </div>
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    className={`${inputClass} pl-[48px] pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((value) => !value)}
                    className={eyeBtn}
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    <img
                      src={showConfirmPassword ? "/assets/icons/auth/eye-off.svg" : "/assets/icons/auth/eye.svg"}
                      alt=""
                      className="h-5 w-5"
                    />
                  </button>
                </div>

                {error ? <p className={errorText}>{error}</p> : null}

                <button type="submit" disabled={loading} className={primaryBtn}>
                  {loading ? "Creating..." : "Create Account"}
                </button>
              </form>
            )}

            {!otpSent ? (
              <>
                <div className="my-4 flex items-center gap-3 sm:my-5">
                  <div className="h-px flex-1 bg-[var(--jd-divider)]" />
                  <span className="text-[13px] font-semibold tracking-wide text-[var(--jd-secondary-text)]">OR</span>
                  <div className="h-px flex-1 bg-[var(--jd-divider)]" />
                </div>

                <div className="space-y-3">
                  <button type="button" onClick={handleGoogleSignup} className={socialBtn}>
                    <img src="/assets/icons/auth/google.svg" alt="" className="h-5 w-5" />
                    <span>Continue with Google</span>
                  </button>
                </div>
              </>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 text-[14px] sm:text-[15px] lg:text-[17px]">
              <span className="font-medium text-[var(--jd-secondary-text)]">Already have an account?</span>
              <Link to="/" className={redLink}>
                Sign In
              </Link>
            </div>
          </section>
        </div>
      </main>

      {modal ? (
        <AuthModal
          title="User already exists"
          message="An account with this email already exists. Login with this email or try another email address."
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => navigate("/", { replace: true, state: { email } })}
              className="h-12 rounded-full bg-gradient-to-b from-[#CF8F70] to-[#A4543A] text-[14px] font-bold text-white sm:text-[15px]"
            >
              Login
            </button>

            <button
              type="button"
              onClick={() => {
                setModal(false);
                setEmail("");
                setOtp("");
                setError("");
                setOtpSent(false);
                setOtpVerified(false);
              }}
              className="h-12 rounded-full border border-[var(--jd-border)] bg-[var(--jd-input)] text-[14px] font-bold text-[var(--jd-primary-text)] hover:bg-white sm:text-[15px]"
            >
              Try another
            </button>
          </div>
        </AuthModal>
      ) : null}
    </>
  );
};

export default Signup;
