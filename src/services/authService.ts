const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

let sessionRestoreRequest: Promise<boolean> | null = null;

export const authService = {
  restoreSession(): Promise<boolean> {
    if (sessionRestoreRequest) return sessionRestoreRequest;

    const request = (async () => {
      const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Unable to verify your session.");
      }
      const result: unknown = await response.json();
      return Boolean(
        result &&
        typeof result === "object" &&
        "authenticated" in result &&
        result.authenticated === true,
      );
    })();

    sessionRestoreRequest = request.finally(() => {
      if (sessionRestoreRequest === restoreRequest) {
        sessionRestoreRequest = null;
      }
    });
    const restoreRequest = sessionRestoreRequest;
    return restoreRequest;
  },

  async logout(): Promise<void> {
    const response = await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    const result: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
          ? result.message
          : "Unable to sign out. Please try again.";
      throw new Error(message);
    }
  },
};
