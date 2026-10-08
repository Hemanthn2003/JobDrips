import { useState } from "react";
import SplashScreen from "./pages/Login/SplashScreen";
import Login from "./pages/Login/Login";

function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <div className="min-h-screen bg-[#FAF6F2]">
      {showSplash ? (
        <SplashScreen onComplete={() => setShowSplash(false)} />
      ) : (
        <Login />
      )}
    </div>
  );
}

export default App;