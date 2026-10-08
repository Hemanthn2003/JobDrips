import { useEffect } from "react";

interface SplashScreenProps {
  onComplete: () => void;
}

const SplashScreen = ({
  onComplete,
}: SplashScreenProps) => {
  useEffect(() => {
    const timer = window.setTimeout(
      onComplete,
      2000
    );

    return () =>
      window.clearTimeout(timer);
  }, [onComplete]);

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#FAF6F2]">
      <picture className="flex min-h-screen w-full items-center justify-center">
        {/* Mobile */}
        <source
          media="(max-width: 640px)"
          srcSet="/assets/brand/jobdrips-global-splash-mobile.svg"
        />

        {/* Tablet */}
        <source
          media="(max-width: 1024px)"
          srcSet="/assets/brand/jobdrips-global-splash-tablet.svg"
        />

        {/* Desktop */}
        <img
          src="/assets/brand/jobdrips-global-splash-desktop.svg"
          alt="JobDrips - Connecting talent with global opportunities"
          className="
            h-auto
            w-[94vw]
            max-h-[90vh]
            max-w-full
            object-contain

            sm:w-[90vw]

            md:w-[84vw]
            md:max-h-[88vh]

            lg:w-[78vw]

            xl:w-[72vw]

            2xl:w-[68vw]
          "
        />
      </picture>

      {/* Loading dots */}
      <div
        className="
          pointer-events-none
          absolute
          bottom-6
          left-1/2
          -translate-x-1/2

          sm:bottom-7

          md:bottom-8
        "
      >
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#B76E4D]" />

          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#B76E4D] [animation-delay:200ms]" />

          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#B76E4D] [animation-delay:400ms]" />
        </div>
      </div>
    </main>
  );
};

export default SplashScreen;