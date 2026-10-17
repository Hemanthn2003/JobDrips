import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Heart, Send, Trash2, X } from "lucide-react";
import { useSocketEvent } from "../../lib/socket";
import { useConfirm } from "../common/ConfirmModal";
import { OverlayLayer, ensureStoryFonts } from "./storyOverlays";
import type { StoryOverlay } from "./storyOverlays";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const IMAGE_STORY_SECONDS = 5;

// The caption can scroll, but never shows a scrollbar.
const HIDE_SCROLLBAR_CSS = `.jd-noscroll{scrollbar-width:none;-ms-overflow-style:none}.jd-noscroll::-webkit-scrollbar{display:none}`;

/** Longer captions get a smaller font so that more text fits. */
const captionFontSize = (length: number) => {
  if (length <= 40) return 24;
  if (length <= 80) return 21;
  if (length <= 140) return 19;
  if (length <= 240) return 17;
  if (length <= 400) return 15.5;
  return 14;
};

export type StoryViewerStory = {
  storyId: string;
  imageUrl: string;
  videoUrl?: string;
  mediaType?: "image" | "video";
  duration?: number;
  /** width / height of the media (0 / missing for older stories). */
  aspect?: number;
  caption?: string;
  overlays?: StoryOverlay[];
  createdAt: string;
  seen?: boolean;
  liked?: boolean;
  viewCount?: number;
  likeCount?: number;
};
export type StoryViewerPerson = { userid: string; username: string; profileimage?: string; stories: StoryViewerStory[] };
type Detail = { userId: string; username: string; profileimage: string; viewedAt?: string };
type ApiResult<T> = { success: boolean; message?: string; data: T };

type Props = {
  person: StoryViewerPerson;
  startIndex?: number;
  isOwner: boolean;
  onClose: () => void;
  onViewed?: (storyId: string) => void;
  onDeleted?: (storyId: string) => void;
  /** Called after a reply was sent (the viewer stays open; nothing else opens). */
  onReplied?: (info: { conversationId: string }) => void;
};

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || "Request failed.");
  return body as T;
}

const isVideoStory = (s: StoryViewerStory) =>
  s.mediaType === "video" || Boolean(s.videoUrl) || /\.(mp4|webm|mov|m4v)(?:[?#].*)?$/i.test(s.videoUrl || s.imageUrl || "");

const ago = (value?: string | null) => {
  if (!value) return "";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
};

function Avatar({ src, name, size = "h-9 w-9" }: { src?: string; name?: string; size?: string }) {
  return src
    ? <img src={src} alt="" className={`${size} shrink-0 rounded-full object-cover`} />
    : <span className={`${size} grid shrink-0 place-items-center rounded-full bg-[#f2dfd3] text-xs font-bold text-[#91452f]`}>{(name || "J").slice(0, 1).toUpperCase()}</span>;
}

export default function StoryViewer({ person, startIndex = 0, isOwner, onClose, onViewed, onDeleted, onReplied }: Props) {
  const { confirm, dialog } = useConfirm();
  const [stories, setStories] = useState<StoryViewerStory[]>(() => person.stories);
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, person.stories.length - 1)));
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const [replyFocus, setReplyFocus] = useState(false);
  const [panel, setPanel] = useState<"" | "views" | "likes">("");
  const [viewers, setViewers] = useState<Detail[]>([]);
  const [likers, setLikers] = useState<Detail[]>([]);
  const [counts, setCounts] = useState({ views: 0, likes: 0 });
  const [liked, setLiked] = useState(false);
  const [reply, setReply] = useState("");
  const [replySent, setReplySent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captionOpen, setCaptionOpen] = useState(false);
  const [captionOverflow, setCaptionOverflow] = useState(false);

  const captionRef = useRef<HTMLDivElement | null>(null);
  const captionScrollRef = useRef<HTMLDivElement | null>(null);
  const elapsed = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const replyInputRef = useRef<HTMLInputElement | null>(null);
  const sentTimer = useRef<number | undefined>(undefined);
  const viewedRef = useRef(new Set<string>());
  const currentIdRef = useRef("");

  const story = stories[index];
  const paused = holding || replyFocus || panel !== "" || captionOpen;
  currentIdRef.current = story?.storyId ?? "";

  useEffect(() => () => window.clearTimeout(sentTimer.current), []);
  useEffect(() => { ensureStoryFonts(); }, []);

  // Two lines of caption fit as they are; anything longer gets a "Read more" link.
  useLayoutEffect(() => {
    const el = captionRef.current;
    if (!el) { setCaptionOverflow(false); return; }
    if (captionOpen) return;
    setCaptionOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [story?.storyId, story?.caption, captionOpen]);

  // Every time the caption is opened / closed, start reading from the top.
  useEffect(() => {
    if (captionScrollRef.current) captionScrollRef.current.scrollTop = 0;
  }, [captionOpen, story?.storyId]);

  const move = (direction: 1 | -1) => {
    const next = index + direction;
    if (next < 0) { elapsed.current = 0; setProgress(0); return; } // restart the first story
    if (next >= stories.length) { onClose(); return; }
    setIndex(next);
  };
  const moveRef = useRef(move);
  moveRef.current = move;

  const loadInteractions = useCallback(async (storyId: string) => {
    try {
      const result = await api<ApiResult<{ viewers: Detail[]; likes: Detail[] }>>(
        `/api/profiles/${encodeURIComponent(person.userid)}/stories/${encodeURIComponent(storyId)}/interactions`,
      );
      if (currentIdRef.current !== storyId) return;
      setViewers(result.data.viewers || []);
      setLikers(result.data.likes || []);
      setCounts({ views: (result.data.viewers || []).length, likes: (result.data.likes || []).length });
    } catch { /* viewer lists are owner-only */ }
  }, [person.userid]);

  useEffect(() => { if (!story) onClose(); }, [story]); // eslint-disable-line react-hooks/exhaustive-deps

  // Runs whenever another story is shown.
  useEffect(() => {
    if (!story) return;
    elapsed.current = 0;
    setProgress(0); setError(""); setPanel(""); setReply(""); setReplySent(false); setCaptionOpen(false);
    setLiked(Boolean(story.liked));
    setViewers([]); setLikers([]);
    setCounts({ views: story.viewCount ?? 0, likes: story.likeCount ?? 0 });
    if (isOwner) {
      void loadInteractions(story.storyId);
    } else if (!story.seen && !viewedRef.current.has(story.storyId)) {
      // Only the first view is recorded (the server ignores repeats as well).
      viewedRef.current.add(story.storyId);
      void api(`/api/profiles/${encodeURIComponent(person.userid)}/stories/${encodeURIComponent(story.storyId)}/view`, { method: "POST", body: "{}" })
        .then(() => {
          setStories((old) => old.map((s) => s.storyId === story.storyId ? { ...s, seen: true } : s));
          onViewed?.(story.storyId);
        })
        .catch(() => undefined);
    }
  }, [story?.storyId, isOwner, person.userid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live counts + lists for the owner (shared socket connection).
  useSocketEvent<{ ownerUserId?: string; storyId?: string }>("story:updated", (payload) => {
    if (!isOwner) return;
    if (payload?.ownerUserId && payload.ownerUserId !== person.userid) return;
    const id = currentIdRef.current;
    if (id && (!payload?.storyId || payload.storyId === id)) void loadInteractions(id);
  });

  // Auto-advance for image stories (progress survives pauses).
  useEffect(() => {
    if (!story || paused || isVideoStory(story)) return;
    const timer = window.setInterval(() => {
      elapsed.current += 0.1;
      const percent = Math.min(100, (elapsed.current / IMAGE_STORY_SECONDS) * 100);
      setProgress(percent);
      if (percent >= 100) { window.clearInterval(timer); moveRef.current(1); }
    }, 100);
    return () => window.clearInterval(timer);
  }, [story?.storyId, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause(); else void video.play().catch(() => undefined);
  }, [paused, story?.storyId]);

  const toggleLike = async () => {
    if (!story || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<ApiResult<{ liked: boolean; likes: string[] }>>(
        `/api/profiles/${encodeURIComponent(person.userid)}/stories/${encodeURIComponent(story.storyId)}/like`,
        { method: "POST", body: "{}" },
      );
      setLiked(result.data.liked);
      setStories((old) => old.map((s) => s.storyId === story.storyId ? { ...s, liked: result.data.liked } : s));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to like this story."); }
    finally { setBusy(false); }
  };

  // Sends the reply as a message. Nothing else opens: the story keeps playing.
  const sendReply = async () => {
    const text = reply.trim();
    if (!story || !text || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<ApiResult<{ conversationId: string }>>(
        `/api/profiles/${encodeURIComponent(person.userid)}/stories/${encodeURIComponent(story.storyId)}/reply`,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setReply("");
      setReplyFocus(false);
      replyInputRef.current?.blur();
      setReplySent(true);
      window.clearTimeout(sentTimer.current);
      sentTimer.current = window.setTimeout(() => setReplySent(false), 2000);
      onReplied?.({ conversationId: result.data.conversationId });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reply to this story."); }
    finally { setBusy(false); }
  };

  const deleteStory = async () => {
    if (!story || busy) return;
    setHolding(false);
    const ok = await confirm({
      title: "Delete this story?",
      message: "It will be removed for everyone. This cannot be undone.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await api(`/api/profiles/me/stories/${encodeURIComponent(story.storyId)}`, { method: "DELETE" });
      const remaining = stories.filter((s) => s.storyId !== story.storyId);
      onDeleted?.(story.storyId);
      if (remaining.length === 0) { onClose(); return; }
      setStories(remaining);
      setIndex((current) => Math.min(current, remaining.length - 1));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete story."); }
    finally { setBusy(false); }
  };

  if (!story) return null;

  const video = isVideoStory(story);
  const mediaUrl = story.videoUrl || story.imageUrl;
  const list = panel === "views" ? viewers : likers;

  const overlays = story.overlays ?? [];
  const caption = (story.caption ?? "").trim();
  const captionSize = captionFontSize(caption.length);

  const mediaNode = video ? (
    <video
      key={story.storyId} ref={videoRef} src={mediaUrl} autoPlay playsInline className="h-full w-full object-contain"
      onTimeUpdate={(e) => { const v = e.currentTarget; if (Number.isFinite(v.duration) && v.duration > 0) setProgress(Math.min(100, (v.currentTime / v.duration) * 100)); }}
      onEnded={() => move(1)}
      onError={() => setError("Unable to load this story.")}
    />
  ) : (
    <img key={story.storyId} src={mediaUrl} alt="Story" draggable={false} className="h-full w-full object-contain" onError={() => setError("Unable to load this story image.")} />
  );

  const hold = (value: boolean) => (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-nohold]")) return;
    setHolding(value);
  };

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-[#140D0B]" onClick={onClose}>
          <style>{HIDE_SCROLLBAR_CSS}</style>
          <div
            className="relative h-[100dvh] w-full max-w-md select-none overflow-hidden bg-black sm:h-[min(94dvh,880px)] sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={hold(true)}
            onPointerUp={hold(false)}
            onPointerCancel={hold(false)}
            onPointerLeave={hold(false)}
          >
            {/* Progress bars */}
            <div className="absolute left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex gap-1.5">
              {stories.map((item, i) => (
                <div key={item.storyId} className="h-1 flex-1 overflow-hidden rounded-full bg-white/35">
                  <div className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear" style={{ width: i < index ? "100%" : i > index ? "0%" : `${progress}%` }} />
                </div>
              ))}
            </div>

            {/* Header */}
            <header className="absolute left-4 right-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+0.9rem)] z-30 flex items-center gap-2 text-white">
              <Avatar src={person.profileimage} name={person.username} />
              <span className="font-semibold">{person.username}</span>
              <span className="text-xs text-white/70">{ago(story.createdAt)}</span>
              <button type="button" data-nohold aria-label="Close story" className="ml-auto rounded-full bg-black/40 p-1.5" onClick={onClose}><X size={20} /></button>
            </header>

            {/* Media, with the stickers / text from the story editor on top (they may also sit on the black area) */}
            {mediaNode}
            {overlays.length > 0 && <OverlayLayer overlays={overlays} />}

            {error && <p role="alert" className="absolute left-4 right-4 top-28 z-30 rounded-xl bg-red-600/90 px-3 py-2 text-center text-xs font-semibold text-white">{error}</p>}
            {replySent && <p role="status" className="absolute left-1/2 top-28 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white">Reply sent ✓</p>}

            {/* Tap zones */}
            <button type="button" aria-label="Previous story" onClick={() => move(-1)} className={`absolute inset-y-24 left-0 z-20 w-[35%] ${panel ? "pointer-events-none" : ""}`} />
            <button type="button" aria-label="Next story" onClick={() => move(1)} className={`absolute inset-y-24 right-0 z-20 w-[65%] ${panel ? "pointer-events-none" : ""}`} />

            {/* Footer: caption (when there is one) above the like / reply row */}
            <div
              data-nohold
              className={`absolute inset-x-0 bottom-0 z-30 flex flex-col bg-gradient-to-t from-black/90 to-transparent pt-16 text-white ${captionOpen ? "via-black/70" : "via-black/50"}`}
            >
              {caption && (
                <div className="px-6 pb-5">
                  {/* Collapsed: max 2 lines + "Read more". Expanded: up to 1/3 of the screen height, scrollable (no scrollbar), "Show less" at the end. */}
                  <div
                    ref={captionScrollRef}
                    className={`jd-noscroll text-center ${captionOpen ? "max-h-[33.333dvh] overflow-y-auto overscroll-contain" : ""}`}
                  >
                    <div
                      ref={captionRef}
                      className="whitespace-pre-wrap break-words font-medium [overflow-wrap:anywhere]"
                      style={{
                        fontSize: captionSize,
                        lineHeight: 1.35,
                        textShadow: "0 1px 6px rgba(0,0,0,.6)",
                        ...(captionOpen
                          ? {}
                          : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }),
                      }}
                    >
                      {caption}
                    </div>
                    {(captionOverflow || captionOpen) && (
                      <button
                        type="button"
                        onClick={() => setCaptionOpen((open) => !open)}
                        className="mt-2 text-xs font-bold text-white/85 underline underline-offset-2"
                      >
                        {captionOpen ? "Show less" : "Read more"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {isOwner ? (
                <div className="flex items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <button type="button" onClick={() => setPanel(panel === "views" ? "" : "views")} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold"><Eye size={15} /> {counts.views} {counts.views === 1 ? "view" : "views"}</button>
                  <button type="button" onClick={() => setPanel(panel === "likes" ? "" : "likes")} className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-xs font-semibold"><Heart size={15} /> {counts.likes} {counts.likes === 1 ? "like" : "likes"}</button>
                  <button type="button" disabled={busy} onClick={() => void deleteStory()} aria-label="Delete story" title="Delete story" className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-white/90 text-[#8B0000] disabled:opacity-60"><Trash2 size={19} /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <form onSubmit={(e) => { e.preventDefault(); void sendReply(); }} className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      ref={replyInputRef} value={reply} onChange={(e) => setReply(e.target.value)} onFocus={() => setReplyFocus(true)} onBlur={() => setReplyFocus(false)}
                      placeholder="Reply to story…" maxLength={2000}
                      className="min-w-0 flex-1 rounded-full border border-white/40 bg-black/35 px-4 py-3 text-sm text-white outline-none placeholder:text-white/70"
                    />
                    <button type="submit" disabled={!reply.trim() || busy} aria-label="Send reply" className="rounded-full bg-[#a94f32] p-3 text-white disabled:opacity-50"><Send size={17} /></button>
                  </form>
                  <button type="button" disabled={busy} onClick={() => void toggleLike()} aria-label={liked ? "Unlike story" : "Like story"} className={`rounded-full p-3 ${liked ? "bg-[#b64d36] text-white" : "bg-white/15 text-white"}`}><Heart size={19} fill={liked ? "currentColor" : "none"} /></button>
                </div>
              )}
            </div>

            {/* Views / likes list (owner) */}
            {isOwner && panel && (
              <div data-nohold className="absolute inset-x-0 bottom-0 z-40 max-h-[65%] overflow-y-auto rounded-t-3xl bg-[#1d1512] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-white">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold">{panel === "views" ? `Views · ${counts.views}` : `Likes · ${counts.likes}`}</h3>
                  <button type="button" aria-label="Close list" onClick={() => setPanel("")} className="rounded-full bg-white/10 p-1.5"><X size={18} /></button>
                </div>
                {list.length === 0 ? (
                  <p className="py-4 text-center text-sm text-white/60">{panel === "views" ? "No views yet." : "No likes yet."}</p>
                ) : list.map((item) => (
                  <div key={`${panel}-${item.userId}`} className="flex items-center gap-3 py-2">
                    <Avatar src={item.profileimage} name={item.username} size="h-10 w-10" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.username}</span>
                    {panel === "views" && <span className="text-xs text-white/60">{ago(item.viewedAt)}</span>}
                    {panel === "likes" && <Heart size={15} className="text-[#e0664b]" fill="currentColor" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
      {dialog}
    </>
  );
}