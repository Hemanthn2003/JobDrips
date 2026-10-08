import type { ReactNode } from "react";

interface AuthModalProps {
  title: string;
  message: string;
  children?: ReactNode;
}

const AuthModal = ({
  title,
  message,
  children,
}: AuthModalProps) => {
  return (
    <div
      className="
        fixed
        inset-0
        z-[100]
        flex
        items-center
        justify-center
        bg-[#2B1F1A]/35
        px-5
        backdrop-blur-[3px]
      "
    >
      <div
        className="
          w-full
          max-w-[390px]
          rounded-[24px]
          border
          border-[var(--jd-border)]
          bg-[var(--jd-card)]
          p-6
          shadow-[var(--jd-shadow-strong)]

          sm:p-7
        "
      >
        {/* ICON */}
        <div
          className="
            mx-auto
            mb-4
            flex
            h-12
            w-12
            items-center
            justify-center
            rounded-full
            bg-[#F3E1D7]
            text-[var(--jd-dark-rose-gold)]
          "
        >
          <span className="text-xl font-black">
            !
          </span>
        </div>

        {/* TITLE */}
        <h2
          className="
            text-center
            text-[19px]
            font-extrabold
            tracking-[-0.02em]
            text-[var(--jd-primary-text)]

            sm:text-[21px]
          "
        >
          {title}
        </h2>

        {/* MESSAGE */}
        <p
          className="
            mt-2
            text-center
            text-[14px]
            font-semibold
            leading-6
            text-[var(--jd-secondary-text)]

            sm:text-[15px]
          "
        >
          {message}
        </p>

        {children ? (
          <div className="mt-5">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AuthModal;