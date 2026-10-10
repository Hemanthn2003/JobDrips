import { Outlet } from "react-router-dom";
import Header from "./Header";
import BottomNavigation from "./BottomNavigation";

const AppLayout = () => {
  return (
    <div className="min-h-screen bg-[var(--jd-warm-white)]">
      <Header />

      <main className="min-h-screen px-3 pb-[100px] pt-[82px] sm:px-5 sm:pb-[108px] sm:pt-[88px] md:px-7 md:pt-[94px] lg:px-10">
        <Outlet />
      </main>

      <BottomNavigation />
    </div>
  );
};

export default AppLayout;