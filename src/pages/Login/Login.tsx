import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthModal from "../../components/auth/AuthModal";

const API_BASE_URL = "http://localhost:5000/api/auth";

/* ---------- shared style tokens (same set is used in Signup / ForgotPassword) ---------- */
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

interface LoginLocationState {
  email?: string;
  authMessage?: string;
}

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginLocationState | null;

  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState(state?.email ?? "");
  const [password, setPassword] = useState("");
  const [inlineError, setInlineError] = useState("");
  const [successMessage, setSuccessMessage] = useState(state?.authMessage ?? "");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [modalType, setModalType] = useState<"incorrect" | "reset" | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    const googleError = params.get("googleError");

    if (google === "success") {
      setSuccessMessage("Google sign in successful. Welcome to JobDrips.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (googleError) {
      setInlineError("Google sign in could not be completed. Please try again.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (state?.email) {
      setEmail(state.email);
      setPassword("");
      setInlineError("");
    }

    if (state?.authMessage) {
      setSuccessMessage(state.authMessage);
    }
  }, [state?.email, state?.authMessage]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInlineError("");
    setSuccessMessage("");

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setInlineError("Enter a valid email address.");
      return;
    }

    if (!password) {
      setInlineError("Enter your password.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          rememberMe,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "USER_NOT_FOUND") {
          setInlineError("User not found. Check your email or create a new account.");
          return;
        }

        if (data.code === "INVALID_PASSWORD") {
          const nextAttempt = failedAttempts + 1;
          setFailedAttempts(nextAttempt);
          setModalType(nextAttempt >= 3 ? "reset" : "incorrect");
          return;
        }

        if (data.code === "GOOGLE_ACCOUNT") {
          setInlineError("This account uses Google sign in. Please continue with Google.");
          return;
        }

        setInlineError(data.message || "Unable to sign in.");
        return;
      }

      setFailedAttempts(0);
      setPassword("");
      navigate("/profile", {
        replace: true,
      });
    } catch {
      setInlineError(
        "Unable to connect to JobDrips server. Make sure the backend is running.",
      );
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = `${API_BASE_URL}/google`;
  };

  const handleCancelReset = () => {
    setModalType(null);
    setFailedAttempts(0);
    setPassword("");
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

        {/* Content: logo area grows, card sits at the bottom */}
        <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[540px] md:max-w-[640px] lg:max-w-[720px] xl:max-w-[780px] flex-col items-center px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pb-8">
          <div className="flex w-full flex-1 items-center justify-center py-4">
            <img
              src="/assets/logo/jobdrips-login-logo-phone-optimized.svg"
              alt="JobDrips"
              className="h-[clamp(120px,26svh,320px)] w-auto max-w-[80vw] object-contain drop-shadow-[0_7px_18px_rgba(75,40,25,0.12)]"
            />
          </div>

          <section className={cardClass}>
            <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-4 lg:space-y-5">
              <div className="relative">
                <div className="pointer-events-none absolute left-[16px] top-1/2 z-10 -translate-y-1/2 text-[var(--jd-icon)]">
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

              <div className="relative">
                <div className="pointer-events-none absolute left-[16px] top-1/2 z-10 -translate-y-1/2 text-[var(--jd-icon)]">
                  <LockIcon />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className={`${inputClass} pl-[48px] pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg hover:bg-[var(--jd-soft-beige)]"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <img
                    src={showPassword ? "/assets/icons/auth/eye-off.svg" : "/assets/icons/auth/eye.svg"}
                    alt=""
                    className="h-5 w-5"
                  />
                </button>
              </div>

              {inlineError ? <p className={errorText}>{inlineError}</p> : null}

              {successMessage ? (
                <p className="px-1 text-[14px] font-bold text-[var(--jd-success)]">{successMessage}</p>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="relative flex h-5 w-5 shrink-0">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                      className="peer h-5 w-5 cursor-pointer appearance-none rounded-[6px] border-2 border-[#C0392B] bg-white checked:bg-[#C0392B]"
                    />
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-white opacity-0 peer-checked:opacity-100"
                    >
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--jd-secondary-text)] sm:text-[14px] lg:text-[16px]">
                    Remember me
                  </span>
                </label>

                <Link
                  to="/forgot-password"
                  state={{ email }}
                  className="text-[13px] font-bold !text-[#C0392B] hover:!text-[#FF2414] hover:underline sm:text-[14px] lg:text-[16px]"
                >
                  Forgot password?
                </Link>
              </div>

              <button type="submit" className={primaryBtn}>
                <span>Sign In</span>
                <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>

            <div className="my-4 flex items-center gap-3 sm:my-5">
              <div className="h-px flex-1 bg-[var(--jd-divider)]" />
              <span className="text-[13px] font-semibold tracking-wide text-[var(--jd-secondary-text)]">OR</span>
              <div className="h-px flex-1 bg-[var(--jd-divider)]" />
            </div>

            <div className="space-y-3">
              <button type="button" onClick={handleGoogleLogin} className={socialBtn}>
                <img src="/assets/icons/auth/google.svg" alt="" className="h-5 w-5" />
                <span>Continue with Google</span>
              </button>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 text-[14px] sm:text-[15px] lg:text-[17px]">
              <span className="font-medium text-[var(--jd-secondary-text)]">Don't have an account?</span>
              <Link to="/signup" className={redLink}>
                Sign Up
              </Link>
            </div>
          </section>
        </div>
      </main>

      {modalType === "incorrect" ? (
        <AuthModal
          title="Incorrect password"
          message="The password you entered is incorrect. Please try again."
        >
          <button
            type="button"
            onClick={() => setModalType(null)}
            className="h-12 w-full rounded-full bg-gradient-to-b from-[#CF8F70] to-[#A4543A] font-bold text-white"
          >
            Try Again
          </button>
        </AuthModal>
      ) : null}

      {modalType === "reset" ? (
        <AuthModal
          title="Reset password?"
          message="You have entered the wrong password three times. Would you like to reset your password?"
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => navigate("/forgot-password", { state: { email } })}
              className="h-12 rounded-full bg-gradient-to-b from-[#CF8F70] to-[#A4543A] text-sm font-bold text-white"
            >
              Reset Password
            </button>

            <button
              type="button"
              onClick={handleCancelReset}
              className="h-12 rounded-full border border-[var(--jd-border)] bg-[var(--jd-input)] text-sm font-bold"
            >
              Cancel
            </button>
          </div>
        </AuthModal>
      ) : null}
    </>
  );
};

export default Login;
