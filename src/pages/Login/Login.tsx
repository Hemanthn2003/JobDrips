import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

const Login = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [emailOrUsername, setEmailOrUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    console.log("Login submitted", {
      emailOrUsername,
      password,
      rememberMe,
    });
  };

  const handleGoogleLogin = () => {
    console.log("Continue with Google");
  };

  return (
    <main className="relative min-h-[100svh] w-full overflow-hidden bg-[var(--jd-warm-white)]">
      {/* =========================================================
          BACKGROUND
      ========================================================= */}
      <div className="absolute inset-0 h-full w-full">
        <picture className="block h-full w-full">
          <source
            media="(max-width: 640px)"
            srcSet="/assets/backgrounds/login-bg-mobile.jpg"
          />

          <source
            media="(max-width: 1024px)"
            srcSet="/assets/backgrounds/login-bg-tablet.jpg"
          />

          <img
            src="/assets/backgrounds/login-bg-desktop.jpg"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover object-center"
          />
        </picture>

        <div className="absolute inset-0 bg-[#6B402D]/[0.035]" />
      </div>

      {/* =========================================================
          JOBDRIPS LOGO
      ========================================================= */}
      <div
        className="
          pointer-events-none
          absolute
          left-1/2
          z-10
          -translate-x-1/2
          top-[17vh]
          sm:top-[15vh]
          md:top-[13vh]
          lg:top-[12vh]
          xl:top-[11vh]
        "
      >
        <img
          src="/assets/logo/jobdrips-login-logo-phone-optimized.svg"
          alt="JobDrips"
          className="
            block
            h-auto
            max-w-none
            w-[500px]
            scale-[1.08]

            sm:w-[500px]
            sm:scale-100

            md:w-[500px]
            md:scale-100

            lg:w-[460px]
            lg:scale-100

            xl:w-[500px]
            xl:scale-100

            2xl:w-[540px]
          "
        />
      </div>

      {/* =========================================================
          LOGIN CARD
      ========================================================= */}
      <section
        className="
          absolute
          left-1/2
          top-[49%]
          z-20
          w-[81.5%]
          -translate-x-1/2
          rounded-[25px]
          border
          border-[var(--jd-border)]
          bg-[var(--jd-card)]/[0.97]
          px-[18px]
          py-[24px]
          shadow-[var(--jd-shadow-strong)]
          backdrop-blur-xl

          sm:w-[76%]
          sm:max-w-[430px]
          sm:px-6
          sm:py-6

          md:w-[62%]
          md:max-w-[470px]
          md:px-7
          md:py-7

          lg:w-[500px]
          lg:max-w-none
          lg:px-8
          lg:py-8

          xl:w-[520px]
        "
      >
        {/* =======================================================
            LOGIN FORM
        ======================================================= */}
        <form
          onSubmit={handleSubmit}
          className="space-y-[15px] sm:space-y-4 md:space-y-[17px]"
        >
          {/* =====================================================
              EMAIL / USERNAME
          ===================================================== */}
          <div className="relative">
            <div
              className="
                pointer-events-none
                absolute
                left-[14px]
                top-1/2
                z-10
                -translate-y-1/2
                text-[var(--jd-icon)]
              "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-[19px] w-[19px] sm:h-5 sm:w-5"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="3"
                />

                <path
                  d="m4 7 8 6 8-6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <input
              id="emailOrUsername"
              type="text"
              value={emailOrUsername}
              onChange={(event) =>
                setEmailOrUsername(event.target.value)
              }
              placeholder="Email or Username"
              autoComplete="username"
              className="
                h-[49px]
                w-full
                rounded-[14px]
                border
                border-[var(--jd-input-border)]
                bg-[var(--jd-input)]
                pl-[43px]
                pr-3
                text-[14px]
                font-semibold
                tracking-[-0.01em]
                text-[var(--jd-primary-text)]
                outline-none
                placeholder:font-medium
                placeholder:text-[var(--jd-placeholder)]
                transition-all
                duration-200
                hover:border-[var(--jd-copper)]
                focus:border-[var(--jd-rose-gold)]
                focus:bg-white
                focus:ring-2
                focus:ring-[var(--jd-rose-gold)]/15

                sm:h-[52px]
                sm:rounded-[15px]
                sm:text-[15px]

                md:h-[55px]
                md:text-[16px]
              "
            />
          </div>

          {/* =====================================================
              PASSWORD
          ===================================================== */}
          <div className="relative">
            <div
              className="
                pointer-events-none
                absolute
                left-[14px]
                top-1/2
                z-10
                -translate-y-1/2
                text-[var(--jd-icon)]
              "
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-[19px] w-[19px] sm:h-5 sm:w-5"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect
                  x="4"
                  y="10"
                  width="16"
                  height="11"
                  rx="2"
                />

                <path
                  d="M8 10V7a4 4 0 0 1 8 0v3"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Password"
              autoComplete="current-password"
              className="
                h-[49px]
                w-full
                rounded-[14px]
                border
                border-[var(--jd-input-border)]
                bg-[var(--jd-input)]
                pl-[43px]
                pr-12
                text-[14px]
                font-semibold
                tracking-[-0.01em]
                text-[var(--jd-primary-text)]
                outline-none
                placeholder:font-medium
                placeholder:text-[var(--jd-placeholder)]
                transition-all
                duration-200
                hover:border-[var(--jd-copper)]
                focus:border-[var(--jd-rose-gold)]
                focus:bg-white
                focus:ring-2
                focus:ring-[var(--jd-rose-gold)]/15

                sm:h-[52px]
                sm:rounded-[15px]
                sm:text-[15px]

                md:h-[55px]
                md:text-[16px]
              "
            />

            {/* PASSWORD VISIBILITY */}
            <button
              type="button"
              onClick={() =>
                setShowPassword((current) => !current)
              }
              aria-label={
                showPassword
                  ? "Hide password"
                  : "Show password"
              }
              className="
                absolute
                right-2
                top-1/2
                flex
                h-8
                w-8
                -translate-y-1/2
                items-center
                justify-center
                rounded-lg
                transition-all
                duration-200
                hover:bg-[var(--jd-soft-beige)]
                active:scale-95
              "
            >
              <img
                src={
                  showPassword
                    ? "/assets/icons/auth/eye-off.svg"
                    : "/assets/icons/auth/eye.svg"
                }
                alt=""
                className="h-[17px] w-[17px] sm:h-[19px] sm:w-[19px]"
              />
            </button>
          </div>

          {/* =====================================================
              REMEMBER ME + FORGOT PASSWORD
          ===================================================== */}
          <div
            className="
              flex
              items-center
              justify-between
              gap-3
              px-[2px]
              pt-0.5
            "
          >
            {/* REMEMBER ME */}
            <label className="flex min-w-0 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) =>
                  setRememberMe(event.target.checked)
                }
                className="
                  h-[18px]
                  w-[18px]
                  shrink-0
                  cursor-pointer
                  appearance-none
                  rounded-[4px]
                  border-[1.8px]
                  border-[var(--jd-rose-gold)]
                  bg-[var(--jd-input)]
                  checked:border-[var(--jd-rose-gold)]
                  checked:bg-[var(--jd-rose-gold)]
                  focus:ring-2
                  focus:ring-[var(--jd-rose-gold)]/20

                  sm:h-[19px]
                  sm:w-[19px]
                "
              />

              <span
                className="
                  whitespace-nowrap
                  text-[clamp(13px,1.15vw,16px)]
                  font-extrabold
                  leading-none
                  tracking-[-0.015em]
                  text-[var(--jd-primary-text)]
                "
              >
                Remember me
              </span>
            </label>

            {/* FORGOT PASSWORD */}
            <Link
              to="/forgot-password"
              className="
                whitespace-nowrap
                text-[clamp(13px,1.15vw,16px)]
                font-extrabold
                leading-none
                tracking-[-0.015em]
                !text-[#D63D2E]
                transition-colors
                duration-200
                hover:!text-[#FF2414]
                hover:underline
                hover:underline-offset-4
                active:!text-[#FF2414]
              "
            >
              Forgot password?
            </Link>
          </div>

          {/* =====================================================
              SIGN IN
          ===================================================== */}
          <button
            type="submit"
            className="
              flex
              h-[47px]
              w-full
              items-center
              justify-center
              gap-2
              rounded-full
              bg-[var(--jd-button)]
              text-[14px]
              font-extrabold
              tracking-[0.01em]
              text-[var(--jd-button-text)]
              shadow-[var(--jd-button-shadow)]
              transition-all
              duration-200
              hover:bg-[var(--jd-button-dark)]
              hover:shadow-[0_8px_20px_rgba(183,110,77,0.30)]
              active:scale-[0.99]

              sm:h-[50px]
              sm:text-[15px]

              md:h-[53px]
              md:text-[16px]
            "
          >
            <span>Sign In</span>

            <span
              className="
                text-[18px]
                font-bold
                leading-none
                sm:text-[20px]
                md:text-[21px]
              "
            >
              →
            </span>
          </button>
        </form>

        {/* =======================================================
            OR
        ======================================================= */}
        <div
          className="
            my-[15px]
            flex
            items-center
            gap-3

            sm:my-4
            md:my-[18px]
          "
        >
          <div className="h-px flex-1 bg-[var(--jd-divider)]" />

          <span
            className="
              text-[12px]
              font-extrabold
              tracking-wide
              text-[var(--jd-secondary-text)]
              sm:text-[13px]
              md:text-[14px]
            "
          >
            OR
          </span>

          <div className="h-px flex-1 bg-[var(--jd-divider)]" />
        </div>

        {/* =======================================================
            GOOGLE
        ======================================================= */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="
            flex
            h-[46px]
            w-full
            items-center
            justify-center
            gap-3
            rounded-full
            border
            border-[var(--jd-input-border)]
            bg-[var(--jd-input)]
            text-[14px]
            font-bold
            tracking-[-0.01em]
            text-[var(--jd-primary-text)]
            shadow-[0_2px_8px_rgba(79,43,28,0.04)]
            transition-all
            duration-200
            hover:border-[var(--jd-copper)]
            hover:bg-white
            active:scale-[0.99]

            sm:h-[49px]
            sm:text-[15px]

            md:h-[51px]
            md:text-[16px]
          "
        >
          <img
            src="/assets/icons/auth/google.svg"
            alt=""
            className="h-[18px] w-[18px] sm:h-5 sm:w-5"
          />

          <span>Continue with Google</span>
        </button>

        {/* =======================================================
            SIGN UP
        ======================================================= */}
        <div
          className="
            mt-5
            flex
            items-center
            justify-center
            gap-2
            text-[clamp(13px,1.15vw,16px)]

            sm:mt-6
            md:mt-7
          "
        >
          <span
            className="
              whitespace-nowrap
              font-extrabold
              leading-none
              tracking-[-0.015em]
              text-[var(--jd-primary-text)]
            "
          >
            Don't have an account?
          </span>

          {/* SIGN UP */}
          <Link
            to="/signup"
            className="
              whitespace-nowrap
              text-[clamp(13px,1.15vw,16px)]
              font-extrabold
              leading-none
              tracking-[-0.015em]
              !text-[#D63D2E]
              transition-colors
              duration-200
              hover:!text-[#FF2414]
              hover:underline
              hover:underline-offset-4
              active:!text-[#FF2414]
            "
          >
            Sign Up
          </Link>
        </div>
      </section>
    </main>
  );
};

export default Login;