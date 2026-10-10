import { Link, useLocation } from "react-router-dom";

const Header = () => {
  const location = useLocation();

  const isRecommendationsActive =
    location.pathname === "/recommendations";

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--jd-border)] bg-[var(--jd-surface)]/97 shadow-[0_2px_16px_rgba(79,43,28,0.09)] backdrop-blur-xl">
      <div
        className="
          mx-auto
          flex
          h-[72px]
          w-full
          max-w-[820px]
          items-center
          gap-0
          px-1
          sm:h-[78px]
          sm:gap-1
          sm:px-2
          md:h-[86px]
          md:gap-2
          md:px-3
          lg:h-[92px]
          lg:gap-3
          lg:px-4
          xl:h-[96px]
          xl:px-5
        "
      >
        <Link
          to="/feed"
          className="flex h-full shrink-0 items-center"
          aria-label="JobDrips Feed"
        >
          <img
            src="/assets/logo/jobdrips-logo.svg"
            alt="JobDrips"
            className="
              h-[52px]
              w-auto
              max-w-[175px]
              object-contain
              sm:h-[58px]
              sm:max-w-[205px]
              md:h-[66px]
              md:max-w-[235px]
              lg:h-[72px]
              lg:max-w-[265px]
              xl:h-[76px]
              xl:max-w-[285px]
            "
          />
        </Link>

        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-1 md:px-2">
          <div
            className="
              relative
              w-full
              max-w-[500px]
              sm:max-w-[580px]
              md:max-w-[660px]
              lg:max-w-[740px]
              xl:max-w-[800px]
            "
          >
            <img
              src="/assets/icons/header/search.svg"
              alt=""
              className="
                pointer-events-none
                absolute
                left-3
                top-1/2
                h-[19px]
                w-[19px]
                -translate-y-1/2
                opacity-75
                sm:left-3
                sm:h-[20px]
                sm:w-[20px]
                md:left-4
                md:h-[21px]
                md:w-[21px]
              "
            />

            <input
              type="search"
              placeholder="Search people, jobs, posts..."
              className="
                h-[42px]
                w-full
                rounded-full
                border
                border-[var(--jd-input-border)]
                bg-[var(--jd-warm-white)]
                pl-10
                pr-4
                text-[12px]
                font-medium
                text-[var(--jd-primary-text)]
                outline-none
                transition-all
                duration-200
                placeholder:text-[var(--jd-placeholder)]
                focus:border-[var(--jd-rose-gold)]
                focus:bg-[var(--jd-surface)]
                focus:ring-2
                focus:ring-[var(--jd-champagne)]
                sm:h-[46px]
                sm:pl-10
                sm:text-[13px]
                md:h-[50px]
                md:pl-11
                md:text-[14px]
                lg:h-[54px]
                lg:pl-12
                lg:text-[15px]
              "
            />
          </div>
        </div>

        <Link
          to="/recommendations"
          aria-label="Recommendations"
          className={`
            flex
            h-[45px]
            w-[45px]
            shrink-0
            items-center
            justify-center
            rounded-[13px]
            border
            transition-all
            duration-300
            sm:h-[50px]
            sm:w-[50px]
            md:h-[55px]
            md:w-[55px]
            lg:h-[60px]
            lg:w-[60px]
            ${
              isRecommendationsActive
                ? "scale-105 border-[var(--jd-dark-rose-gold)] bg-[var(--jd-champagne)] shadow-[0_0_22px_rgba(217,166,138,0.55)]"
                : "border-[var(--jd-border)] bg-[var(--jd-rose-gold)] hover:scale-105 hover:bg-[var(--jd-dark-rose-gold)]"
            }
          `}
        >
          <img
            src={
              isRecommendationsActive
                ? "/assets/icons/header/recommendations-active.svg"
                : "/assets/icons/header/recommendations.svg"
            }
            alt=""
            className="
              h-[28px]
              w-[28px]
              object-contain
              sm:h-[30px]
              sm:w-[30px]
              md:h-[33px]
              md:w-[33px]
              lg:h-[36px]
              lg:w-[36px]
            "
          />
        </Link>
      </div>
    </header>
  );
};

export default Header;