import { useState } from "react";

import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import SplashScreen from "./pages/Login/SplashScreen";
import Login from "./pages/Login/Login";

import Signup from "./pages/Auth/Signup";
import ForgotPassword from "./pages/Auth/ForgotPassword";

function App() {
  const [showSplash, setShowSplash] =
    useState(true);

  if (showSplash) {
    return (
      <SplashScreen
        onComplete={() =>
          setShowSplash(false)
        }
      />
    );
  }

  return (
    <Routes>
      {/* LOGIN */}
      <Route
        path="/"
        element={<Login />}
      />

      {/* SIGN UP */}
      <Route
        path="/signup"
        element={<Signup />}
      />

      {/* OLD REGISTER PATH → SIGN UP */}
      <Route
        path="/register"
        element={
          <Navigate
            to="/signup"
            replace
          />
        }
      />

      {/* FORGOT PASSWORD */}
      <Route
        path="/forgot-password"
        element={
          <ForgotPassword />
        }
      />

      {/* UNKNOWN URL */}
      <Route
        path="*"
        element={
          <Navigate
            to="/"
            replace
          />
        }
      />
    </Routes>
  );
}

export default App;