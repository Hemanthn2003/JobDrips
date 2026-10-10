import { NavLink } from "react-router-dom";

interface NavigationItemProps {
  to: string;
  label: string;
  icon: string;
  activeIcon: string;
}

const NavigationItem = ({
  to,
  label,
  icon,
  activeIcon,
}: NavigationItemProps) => {
  return (
    <NavLink
      to={to}
      className="relative flex h-full min-w-0 flex-1 items-center justify-center"
    >
      {({ isActive }) => (
        <div
          className={`
            relative
            flex
            h-full
            w-full
            max-w-[100px]
            flex-col
            items-center
            justify-start
            pt-0
            sm:max-w-[115px]
            md:max-w-[130px]
            lg:max-w-[140px]
            ${
              isActive
                ? "scale-[1.02] text-[var(--jd-dark-rose-gold)]"
                : "text-[var(--jd-secondary-text)]"
            }
          `}
        >
          {/* ICON */}
          <div
            className={`
              relative
              flex
              h-[53px]
              w-[53px]
              shrink-0
              items-center
              justify-center
              sm:h-[55px]
              sm:w-[55px]
              md:h-[57px]
              md:w-[57px]
              lg:h-[59px]
              lg:w-[59px]
              ${
                isActive
                  ? "animate-[jd-nav-breathe_2.8s_ease-in-out_infinite]"
                  : ""
              }
            `}
          >
            <img
              src={isActive ? activeIcon : icon}
              alt=""
              className="
                relative
                z-10
                h-[52px]
                w-[52px]
                object-contain
                sm:h-[54px]
                sm:w-[54px]
                md:h-[56px]
                md:w-[56px]
                lg:h-[58px]
                lg:w-[58px]
              "
            />
          </div>

          {/* LABEL */}
          <span
            className={`
              -mt-[1px]
              whitespace-nowrap
              text-center
              text-[11px]
              font-black
              leading-none
              sm:text-[12px]
              md:text-[13px]
              lg:text-[14px]
              ${
                isActive
                  ? "text-[var(--jd-dark-rose-gold)]"
                  : "text-[var(--jd-secondary-text)]"
              }
            `}
          >
            {label}
          </span>
        </div>
      )}
    </NavLink>
  );
};

const BottomNavigation = () => {
  return (
    <nav
      className="
        fixed
        inset-x-0
        bottom-0
        z-50
        h-[70px]
        overflow-visible
        border-t
        border-[var(--jd-border)]
        bg-[var(--jd-surface)]/97
        shadow-[0_-5px_24px_rgba(79,43,28,0.11)]
        backdrop-blur-xl
        sm:h-[72px]
        md:h-[74px]
        lg:h-[76px]
      "
    >
      <div
        className="
          mx-auto
          flex
          h-full
          w-full
          max-w-[820px]
          items-stretch
          px-0
        "
      >
        {/* FEED */}
        <NavigationItem
          to="/feed"
          label="Feed"
          icon="/assets/icons/navigation/feed.svg"
          activeIcon="/assets/icons/navigation/feed-active.svg"
        />

        {/* MESSAGES */}
        <NavigationItem
          to="/messages"
          label="Messages"
          icon="/assets/icons/navigation/messages.svg"
          activeIcon="/assets/icons/navigation/messages-active.svg"
        />

        {/* ADD POST */}
        <NavLink
          to="/add-post"
          className="
            relative
            flex
            h-full
            min-w-0
            flex-1
            items-stretch
            justify-center
          "
          aria-label="Add Post"
        >
          {({ isActive }) => (
            <div
              className={`
                relative
                h-full
                w-full
                max-w-[100px]
                sm:max-w-[115px]
                md:max-w-[130px]
                lg:max-w-[140px]
                ${
                  isActive
                    ? "scale-[1.02]"
                    : "hover:scale-[1.02]"
                }
              `}
            >
              {/* CENTER ADD POST BUTTON */}
              <div
                className={`
                  absolute
                  left-1/2
                  top-[-20px]
                  z-20
                  flex
                  h-[76px]
                  w-[76px]
                  -translate-x-1/2
                  items-center
                  justify-center
                  rounded-full
                  border
                  border-[var(--jd-border)]
                  bg-[var(--jd-surface)]
                  shadow-[0_8px_26px_rgba(79,43,28,0.25)]
                  transition-all
                  duration-300
                  sm:top-[-21px]
                  sm:h-[79px]
                  sm:w-[79px]
                  md:top-[-22px]
                  md:h-[82px]
                  md:w-[82px]
                  lg:top-[-23px]
                  lg:h-[85px]
                  lg:w-[85px]
                  ${
                    isActive
                      ? "ring-2 ring-[var(--jd-champagne)] shadow-[0_8px_30px_rgba(183,110,77,0.33)]"
                      : ""
                  }
                `}
              >
                <img
                  src={
                    isActive
                      ? "/assets/icons/navigation/add-center-active.svg"
                      : "/assets/icons/navigation/add-center.svg"
                  }
                  alt=""
                  className="
                    h-full
                    w-full
                    rounded-full
                    object-cover
                  "
                />
              </div>

              {/* ADD POST LABEL */}
              <span
                className={`
                  absolute
                  bottom-[2px]
                  left-1/2
                  z-30
                  -translate-x-1/2
                  whitespace-nowrap
                  text-center
                  text-[11px]
                  font-black
                  leading-none
                  sm:text-[12px]
                  md:text-[13px]
                  lg:text-[14px]
                  ${
                    isActive
                      ? "text-[var(--jd-dark-rose-gold)]"
                      : "text-[var(--jd-secondary-text)]"
                  }
                `}
              >
                Add Post
              </span>
            </div>
          )}
        </NavLink>

        {/* NOTIFICATIONS */}
        <NavigationItem
          to="/notifications"
          label="Notifications"
          icon="/assets/icons/navigation/notifications.svg"
          activeIcon="/assets/icons/navigation/notifications-active.svg"
        />

        {/* PROFILE */}
        <NavigationItem
          to="/profile"
          label="Profile"
          icon="/assets/icons/navigation/profile.svg"
          activeIcon="/assets/icons/navigation/profile-active.svg"
        />
      </div>

      <style>{`
        @keyframes jd-nav-breathe {
          0%,
          100% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.045);
          }
        }
      `}</style>
    </nav>
  );
};

export default BottomNavigation;