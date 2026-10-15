import { refreshBadges } from "../services/notificationService";
import { useSocketEvent } from "./socket";

/**
 * Keeps the bottom-navigation badges (notifications bell and unread messages)
 * live. Call it once inside a component that is always mounted, such as the
 * bottom navigation. It reuses the existing refreshBadges() helper, so the
 * navigation reloads its counts the same way it already does.
 */
export function useLiveBadges() {
  useSocketEvent("notification:new", () => refreshBadges());
  useSocketEvent("notification:read", () => refreshBadges());
  useSocketEvent("message:new", () => refreshBadges());
  useSocketEvent("message:read", () => refreshBadges());
  useSocketEvent("conversation:updated", () => refreshBadges());
  useSocketEvent("friend:updated", () => refreshBadges());
  useSocketEvent("connect", () => refreshBadges());
}