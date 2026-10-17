import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import SplashScreen from "./pages/Login/SplashScreen";
import Login from "./pages/Login/Login";
import Signup from "./pages/Auth/Signup";
import ForgotPassword from "./pages/Auth/ForgotPassword";

import AppLayout from "./components/layout/AppLayout";

import Feed from "./pages/Feed/Feed";
import Recommendations from "./pages/Recommendations/Recommendations";
import Messages from "./pages/Messages/Messages";
import AddPost from "./pages/AddPost/AddPost";
import Notifications from "./pages/Notifications/Notifications";
import Profile from "./pages/Profile/Profile";
import ViewPost from "./pages/ViewPost/ViewPost";
import { authService } from "./services/authService";

function SessionCheck() {
  return (
    <main className="grid min-h-[100svh] place-items-center bg-[var(--jd-warm-white)]">
      <span
        role="status"
        aria-label="Checking your session"
        className="h-9 w-9 animate-spin rounded-full border-4 border-[#f0ded2] border-t-[#a4543a]"
      />
    </main>
  );
}

function ProtectedRoutes() {
  const { pathname } = useLocation();
  const [status, setStatus] = useState<"checking" | "authenticated" | "unauthenticated" | "error">("checking");
  const [validatedPath, setValidatedPath] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let checking = false;

    const validate = () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      setStatus("checking");
      setValidatedPath("");
      void authService.restoreSession()
        .then((valid) => {
          if (active) {
            setStatus(valid ? "authenticated" : "unauthenticated");
            setValidatedPath(pathname);
          }
        })
        .catch(() => {
          if (active) {
            setStatus("error");
            setValidatedPath(pathname);
          }
        })
        .finally(() => { checking = false; });
    };

    validate();
    window.addEventListener("focus", validate);
    document.addEventListener("visibilitychange", validate);
    return () => {
      active = false;
      window.removeEventListener("focus", validate);
      document.removeEventListener("visibilitychange", validate);
    };
  }, [pathname, retry]);

  if (validatedPath !== pathname) return <SessionCheck />;
  if (status === "checking") return <SessionCheck />;
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  if (status === "error") {
    return (
      <main className="grid min-h-[100svh] place-items-center bg-[var(--jd-warm-white)] px-5 text-center">
        <div>
          <p role="alert" className="font-semibold text-[var(--jd-secondary-text)]">
            Unable to verify your session. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => setRetry((count) => count + 1)}
            className="mt-4 rounded-xl bg-[#654536] px-5 py-2.5 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return <Outlet />;
}

function InitialSessionRedirect() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void authService.restoreSession()
      .then((valid) => {
        if (active) setAuthenticated(valid);
      })
      .catch(() => {
        if (active) setAuthenticated(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (authenticated === null) {
    return (
      <main className="grid min-h-[100svh] place-items-center bg-[var(--jd-warm-white)]">
        <span
          role="status"
          aria-label="Checking your session"
          className="h-9 w-9 animate-spin rounded-full border-4 border-[#f0ded2] border-t-[#a4543a]"
        />
      </main>
    );
  }

  return <Navigate to={authenticated ? "/profile" : "/login"} replace />;
}

function App() {
  const [showSplash, setShowSplash] = useState(true);

  if (showSplash) {
    return (
      <SplashScreen
        onComplete={() => setShowSplash(false)}
      />
    );
  }

  return (
    <>
      <Routes>
        {/* Authentication */}
        <Route path="/" element={<InitialSessionRedirect />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/signup"
          element={<Signup />}
        />

        <Route
          path="/register"
          element={<Navigate to="/signup" replace />}
        />

        <Route
          path="/forgot-password"
          element={<ForgotPassword />}
        />

        {/* Main JobDrips Application */}
        <Route element={<ProtectedRoutes />}>
          <Route element={<AppLayout />}>
          <Route
            path="/feed"
            element={<Feed />}
          />

          <Route
            path="/recommendations"
            element={<Recommendations />}
          />

          <Route
            path="/messages"
            element={<Messages />}
          />

          <Route
            path="/add-post"
            element={<AddPost />}
          />
          <Route path="/profile/:userid/posts/:postId" element={<ViewPost />} />
          <Route
            path="/notifications"
            element={<Notifications />}
          />

          <Route
            path="/profile"
            element={<Profile />}
          />

          {/* Another member's profile (friends list, feed header, etc.) */}
          <Route
            path="/profile/:userid"
            element={<Profile />}
          />
          </Route>
        </Route>

        {/* Unknown URL */}
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Routes>
    </>
  );
}

export default App;
