import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import Header from "./Header";
import BottomNavigation from "./BottomNavigation";

const PERSISTENT_ROUTES = new Set([
  "/feed",
  "/recommendations",
  "/messages",
  "/notifications",
  "/profile",
]);

type CachedOutlet = ReadonlyMap<string, ReactNode>;

let cachedOutlets: CachedOutlet = new Map();
const outletCacheListeners = new Set<() => void>();

const subscribeToOutletCache = (listener: () => void) => {
  outletCacheListeners.add(listener);
  return () => outletCacheListeners.delete(listener);
};

const getOutletCacheSnapshot = () => cachedOutlets;

const cacheOutlet = (path: string, outlet: ReactNode) => {
  if (cachedOutlets.has(path)) return;
  cachedOutlets = new Map(cachedOutlets).set(path, outlet);
  outletCacheListeners.forEach((listener) => listener());
};

const clearOutletCache = () => {
  if (cachedOutlets.size === 0) return;
  cachedOutlets = new Map();
  outletCacheListeners.forEach((listener) => listener());
};

function PersistentOutlet() {
  const location = useLocation();
  const outlet = useOutlet();
  const currentPath = location.pathname;
  const cached = useSyncExternalStore(
    subscribeToOutletCache,
    getOutletCacheSnapshot,
    getOutletCacheSnapshot,
  );

  useEffect(() => {
    if (PERSISTENT_ROUTES.has(currentPath) && outlet) cacheOutlet(currentPath, outlet);
  }, [currentPath, outlet]);

  if (!PERSISTENT_ROUTES.has(currentPath)) {
    return <>{outlet}</>;
  }

  const outlets = new Map(cached);
  if (outlet && !outlets.has(currentPath)) outlets.set(currentPath, outlet);

  return (
    <>
      {[...outlets].map(([path, element]) => (
        <div key={path} className={path === currentPath ? "contents" : "hidden"}>
          {element}
        </div>
      ))}
    </>
  );
}

const AppLayout = () => {
  useEffect(() => clearOutletCache, []);

  return (
    <div className="min-h-screen bg-[var(--jd-warm-white)]">
      <Header />

      <main className="min-h-screen px-3 pb-[100px] pt-[82px] sm:px-5 sm:pb-[108px] sm:pt-[88px] md:px-7 md:pt-[94px] lg:px-10">
        <PersistentOutlet />
      </main>

      <BottomNavigation />
    </div>
  );
};

export default AppLayout;