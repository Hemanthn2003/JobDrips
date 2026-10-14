const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

export type NotificationKind =
  | "friend_request"
  | "friend_accepted"
  | "post_like"
  | "comment"
  | "comment_reply"
  | "mention"
  | "post_share"
  | "message";

export interface NotificationPost {
  postId: string;
  ownerId: string;
  ownerUsername: string;
  imageUrl: string;
  caption: string;
}

export interface NotificationItem {
  notificationId: string;
  type: NotificationKind;
  message: string;
  text: string;
  mentionIn: "comment" | "post" | "";
  commentId: string | null;
  read: boolean;
  createdAt: string;
  actor: { userid: string; username: string; profileimage: string };
  post: NotificationPost | null;
  /** Friend requests only: true while the request still waits for an answer. */
  requestPending: boolean;
}

export interface NotificationSummary {
  unreadNotifications: number;
  /** Number of PEOPLE with unread messages (not the number of messages). */
  unseenMessagePeople: number;
}

interface ApiResult<T> {
  success: boolean;
  message?: string;
  data: T;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { Accept: "application/json" },
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
        : `Request failed (${response.status})`;

    throw new Error(message);
  }

  return result as T;
}

export const notificationService = {
  async getSummary(): Promise<NotificationSummary> {
    const result = await request<ApiResult<NotificationSummary>>(
      "/api/notifications/summary",
    );
    return result.data;
  },

  async list(): Promise<NotificationItem[]> {
    const result = await request<
      ApiResult<{ notifications: NotificationItem[] }>
    >("/api/notifications");
    return result.data.notifications;
  },

  async markAllRead(): Promise<void> {
    await request<{ success: boolean }>("/api/notifications/read-all", {
      method: "POST",
    });
  },
};

/** Tells the bottom navigation to reload its badges right away. */
export const NOTIFICATION_REFRESH_EVENT = "jobdrips:refresh-badges";

export const refreshBadges = (): void => {
  window.dispatchEvent(new Event(NOTIFICATION_REFRESH_EVENT));
};
