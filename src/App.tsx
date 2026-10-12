import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

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
    <Routes>
      {/* Authentication */}
      <Route path="/" element={<Login />} />

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

      {/* Unknown URL */}
      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}

export default App;
