import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Bell, Trash2 } from "lucide-react";
import { profileService } from "../../services/profileService";
import {
  notificationService,
  refreshBadges,
} from "../../services/notificationService";
import type { NotificationItem } from "../../services/notificationService";
import { PersonAvatar, timeAgoLong } from "../../components/post/postUtils";
import { useConfirm } from "../../components/common/ConfirmModal";
import { useSocketEvent } from "../../lib/socket";

const errText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const profilePath = (userid: string) => `/profile/${encodeURIComponent(userid)}`;
const postPath = (ownerId: string, postId: string) =>
  `/profile/${encodeURIComponent(ownerId)}/posts/${encodeURIComponent(postId)}`;

function PostThumb({ item }: { item: NotificationItem }) {
  const post = item.post;
  if (!post) return null;

  return (
    <Link
      to={postPath(post.ownerId, post.postId)}
      className="mt-2 flex items-center gap-2.5 rounded-xl border border-[#eee4dd] bg-[#fbf8f6] p-1.5 pr-3 transition hover:bg-[#f6efea]"
    >
      {post.imageUrl ? (
        <img
          src={post.imageUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        <span className="h-10 w-10 shrink-0 rounded-lg bg-[#f0dfd3]" />
      )}
      <span className="min-w-0 truncate text-xs text-[#7b675b]">
        {post.caption || `Post by @${post.ownerUsername}`}
      </span>
    </Link>
  );
}

function Row({
  item,
  busy,
  onAccept,
  onDeny,
}: {
  item: NotificationItem;
  busy: boolean;
  onAccept: (item: NotificationItem) => void;
  onDeny: (item: NotificationItem) => void;
}) {
  const navigate = useNavigate();
  const who = item.actor.username || "Someone";
  const ownerName = item.post?.ownerUsername ? `@${item.post.ownerUsername}` : "a";

  const openTarget = () => {
    if (item.post) navigate(postPath(item.post.ownerId, item.post.postId));
    else navigate(profilePath(item.actor.userid));
  };

  let headline = item.message;
  if (item.type === "friend_request") headline = "sent you a friend request.";
  else if (item.type === "friend_accepted") headline = "accepted your friend request.";
  else if (item.type === "comment") headline = "commented on your post.";
  else if (item.type === "comment_reply") headline = "replied to your comment.";
  else if (item.type === "mention")
    headline =
      item.mentionIn === "post"
        ? `mentioned you in ${ownerName === "a" ? "a" : `${ownerName}'s`} post.`
        : `mentioned you in ${ownerName === "a" ? "a" : `${ownerName}'s`} post comment.`;

  const showText =
    (item.type === "comment" ||
      item.type === "comment_reply" ||
      item.type === "mention") &&
    item.text;

  return (
    <li
      className={`flex items-start gap-3 rounded-2xl border px-3.5 py-3 ${
        item.read
          ? "border-[#eee4dd] bg-white"
          : "border-[#ecd5c8] bg-[#fff8f4]"
      }`}
    >
      <Link to={profilePath(item.actor.userid)} className="shrink-0">
        <PersonAvatar
          src={item.actor.profileimage}
          name={who}
          className="h-11 w-11"
        />
      </Link>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-[#493c34]">
          <Link
            to={profilePath(item.actor.userid)}
            className="font-bold text-[#332720] hover:underline"
          >
            {who}
          </Link>{" "}
          {headline}
          <span className="ml-1.5 whitespace-nowrap text-xs text-[#9a897e]">
            {timeAgoLong(item.createdAt)}
          </span>
        </p>

        {item.type !== "friend_request" &&
          item.type !== "friend_accepted" && <PostThumb item={item} />}

        {showText && (
          <button
            type="button"
            onClick={openTarget}
            className="mt-1.5 block max-w-full truncate text-left text-sm text-[#7b675b] hover:text-[#654536]"
          >
            {item.type === "mention" ? "mention: " : ""}
            {item.text}
          </button>
        )}

        {item.type === "friend_request" && (
          <div className="mt-2.5 flex gap-2">
            {item.requestPending ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAccept(item)}
                  className="rounded-full bg-[#A4543A] px-5 py-1.5 text-sm font-bold text-white transition hover:bg-[#8d4630] disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeny(item)}
                  className="rounded-full border border-[#e3cfc4] bg-white px-5 py-1.5 text-sm font-bold text-[#654536] transition hover:bg-[#faf5f2] disabled:opacity-50"
                >
                  Deny
                </button>
              </>
            ) : (
              <span className="text-xs font-semibold text-[#9a897e]">
                Already answered
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

const Notifications = () => {
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const { confirm, dialog } = useConfirm();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [clearing, setClearing] = useState(false);
  const reloadTimer = useRef<number | undefined>(undefined);
  const refreshOnActivate = useRef(false);
  const loadRequest = useRef<Promise<void> | null>(null);

  const load = useCallback((markRead = false) => {
    if (loadRequest.current) return loadRequest.current;
    const request = Promise.resolve().then(async () => {
      setError("");

      try {
        // The server only returns notifications that were not deleted,
        // so after a delete only brand new ones appear here.
        setItems(await notificationService.list());

        if (markRead) {
          // Opening the page clears the red dot; new ones bring it back.
          await notificationService.markAllRead();
          setItems((current) => current.map((item) => ({ ...item, read: true })));
          refreshBadges();
        }
      } catch (err: unknown) {
        setError(errText(err, "Unable to load your notifications."));
      } finally {
        setLoading(false);
        if (loadRequest.current === request) loadRequest.current = null;
      }
    });
    loadRequest.current = request;
    return request;
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (pathname !== "/notifications" || !refreshOnActivate.current) return;
    refreshOnActivate.current = false;
    void load(true);
  }, [pathname, load]);

  const reloadSoon = useCallback(() => {
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      if (pathnameRef.current !== "/notifications") {
        refreshOnActivate.current = true;
        return;
      }
      void load();
    }, 250);
  }, [load]);

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);
  useSocketEvent("notification:new", () => {
    if (pathname !== "/notifications") {
      refreshOnActivate.current = true;
      return;
    }
    reloadSoon();
  });
  useSocketEvent<{ userId?: string }>("notification:read", () => {
    setItems((current) => current.map((item) => ({ ...item, read: true })));
  });

  const answer = async (item: NotificationItem, accept: boolean) => {
    if (busyId) return;
    setBusyId(item.notificationId);
    setError("");

    try {
      if (accept) await profileService.acceptFriendRequest(item.actor.userid);
      else await profileService.declineFriendRequest(item.actor.userid);

      // Accepting or denying removes the request notification.
      setItems((previous) =>
        previous.filter(
          (current) => current.notificationId !== item.notificationId,
        ),
      );
    } catch (err: unknown) {
      setError(errText(err, "Unable to answer this request."));
    } finally {
      setBusyId("");
    }
  };

  const clearAll = async () => {
    if (clearing || items.length === 0) return;

    const ok = await confirm({
      title: "Delete all notifications?",
      message: "Your notification list will be cleared. Only new notifications will show up from now on.",
      confirmText: "Delete all",
      tone: "danger",
    });
    if (!ok) return;

    setClearing(true);
    setError("");

    try {
      await notificationService.clearAll();
      setItems([]);
      refreshBadges();
    } catch (err: unknown) {
      setError(errText(err, "Unable to delete your notifications."));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[640px] pb-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-black text-[#332720]">Notifications</h1>

        {!loading && items.length > 0 && (
          <button
            type="button"
            onClick={() => void clearAll()}
            disabled={clearing}
            aria-label="Delete all notifications"
            title="Delete all"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#eee4dd] bg-white text-[#8b7a70] transition hover:bg-[#fdeeea] hover:text-[#b4432f] disabled:opacity-50"
          >
            <Trash2 size={19} />
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-xl bg-[#fdeeea] px-4 py-3 text-sm text-[#b4432f]">
          {error}
        </p>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((key) => (
            <div key={key} className="h-[76px] animate-pulse rounded-2xl bg-[#f4efeb]" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="rounded-2xl border border-[#eee4dd] bg-white px-6 py-14 text-center">
          <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#f3eae4] text-[#795b4b]">
            <Bell size={24} />
          </span>
          <h2 className="text-base font-bold text-[#332720]">You're all caught up</h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-[#8b7a70]">
            Friend requests, comments and mentions will show up here.
          </p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <Row
              key={item.notificationId}
              item={item}
              busy={busyId === item.notificationId}
              onAccept={(current) => void answer(current, true)}
              onDeny={(current) => void answer(current, false)}
            />
          ))}
        </ul>
      )}

      {dialog}
    </div>
  );
};

export default Notifications;