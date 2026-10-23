import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, CheckCheck, Image as ImageIcon, MoreHorizontal, Paperclip, Search, Send, Users, X } from "lucide-react";
import { profileService, type Profile as ProfileData } from "../../services/profileService";
import StoriesSection, { type StoryPerson } from "../../components/story/StoriesSection";
import { useAddStory } from "../../components/story/useAddStory";
import { useConfirm } from "../../components/common/ConfirmModal";
import { useSocketEvent } from "../../lib/socket";
import ConversationSheet from "./ConversationSheet";
import GroupInfoSheet from "./GroupInfoSheet";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
type Person = { userid: string; username: string; name?: string; profileimage?: string };
type SharedPostPreview = { postId: string; ownerId: string; username: string; profileimage: string; imageUrl: string; caption: string };
type SystemInfo = { action: string; actorId: string; actorName: string; targets: Array<{ userId: string; name: string }>; detail?: string };
type ChatMessage = { messageId: string; conversationId: string; senderUserId: string; recipientUserId?: string; text: string; kind: string; type?: string; imageUrl?: string; sharedPostId?: string | null; sharedPostOwnerId?: string | null; sharedPostPreview?: SharedPostPreview | null; storyId?: string | null; storyOwnerId?: string | null; storyImageUrl?: string | null; senderAvatar?: string; senderUsername?: string; storyOwnerName?: string; system?: SystemInfo | null; readAt?: string | null; readBy?: string[]; createdAt: string };
type ConversationRow = { conversationId: string; type: "direct" | "group"; person?: Person; title: string; photoUrl?: string; lastMessage: string; lastMessageAt?: string | null; unreadCount: number; background?: string; members?: Array<{ userId: string; role: string; person?: Person }> };
type ApiResult<T> = { success: boolean; message?: string; data: T };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Same outer spacing as StoriesSection, so the search bar, stories and list line up.
const EDGE_SPACING = "mx-4 sm:mx-5 lg:mx-6";

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, credentials: "include", headers: { ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || "Request failed.");
  return body as T;
}
const ago = (value?: string | null) => {
  if (!value) return "";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};
const localDateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const messageDateLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  if (localDateKey(date) === localDateKey(today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (localDateKey(date) === localDateKey(yesterday)) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
};
const messageTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hour = date.getHours() % 12 || 12;
  return `${String(hour).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const initials = (value = "") => value.trim().slice(0, 1).toUpperCase() || "J";
const isSystem = (m: Pick<ChatMessage, "kind" | "type">) => m.kind === "system" || m.type === "system";
const previewOf = (m: Pick<ChatMessage, "text" | "imageUrl" | "sharedPostId" | "kind">) =>
  m.text || (m.imageUrl ? "Sent an image" : m.sharedPostId ? "Shared a post" : m.kind === "story_reply" ? "Replied to a story" : "");
const imageError = (file: File) => !IMAGE_TYPES.includes(file.type) ? "Choose a JPG, PNG or WebP image." : file.size > MAX_IMAGE_BYTES ? "Images must be 5 MB or smaller." : "";
const uploadImage = async (file: File) => {
  const form = new FormData();
  form.append("image", file);
  const uploaded = await api<ApiResult<{ secureUrl: string }>>("/api/uploads/image", { method: "POST", body: form });
  return uploaded.data.secureUrl;
};

/** Personalised wording: "You added Alice", "Bob added you", "Bob added Alice". */
const systemText = (m: ChatMessage, meId?: string) => {
  const s = m.system;
  if (!s) return m.text;
  const actor = s.actorId === meId ? "You" : s.actorName || "Someone";
  const names = (s.targets || []).map((t) => (t.userId === meId ? "you" : t.name || "someone")).join(", ");
  switch (s.action) {
    case "created": return `${actor} created this group`;
    case "added": return `${actor} added ${names}`;
    case "removed": return `${actor} removed ${names}`;
    case "left": return `${actor} left`;
    case "photo": return s.detail === "removed" ? `${actor} removed the group photo` : `${actor} changed the group photo`;
    case "renamed": return `${actor} renamed the group to “${s.detail || ""}”`;
    case "promoted": return `${actor} made ${names} an admin`;
    case "demoted": return `${actor} removed ${names} as admin`;
    default: return m.text;
  }
};

function Avatar({ src, name, size = "h-12 w-12" }: { src?: string; name?: string; size?: string }) {
  return src ? <img src={src} alt="" className={`${size} shrink-0 rounded-2xl object-cover ring-1 ring-[#ead8cc]`} /> : <div className={`${size} grid shrink-0 place-items-center rounded-2xl bg-[#f2dfd3] font-bold text-[#91452f]`}>{initials(name)}</div>;
}

function SystemNote({ m, meId }: { m: ChatMessage; meId?: string }) {
  return (
    <div className="flex justify-center px-2">
      <span className="max-w-[85%] rounded-full bg-white/85 px-3.5 py-1 text-center text-[11px] font-medium text-[#6f5c52] shadow-sm ring-1 ring-[#ead8cc]">
        {systemText(m, meId)}
      </span>
    </div>
  );
}

function Bubble({ m, mine, meId, group, onImage, onPost, onMediaLoad }: { m: ChatMessage; mine: boolean; meId?: string; group: boolean; onImage: (url: string) => void; onPost: (m: ChatMessage) => void; onMediaLoad: () => void }) {
  // readBy always contains the sender, so "seen" means someone else is in it.
  const seen = Boolean(m.readAt) || (m.readBy || []).some((id) => id !== m.senderUserId);
  const hasImage = Boolean(m.imageUrl);
  const preview = m.sharedPostPreview;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[70%] overflow-hidden rounded-2xl shadow-sm ${hasImage ? "p-1" : "px-4 py-2.5"} ${mine ? "rounded-br-md bg-gradient-to-br from-[#c77e5d] to-[#98452f] text-white" : "rounded-bl-md border border-[#ecdcd1] bg-white text-[#3c2d26]"}`}>
        {group && !mine && m.senderUsername && <p className={`text-[11px] font-bold text-[#a65336] ${hasImage ? "px-3 pt-1.5" : "mb-0.5"}`}>{m.senderUsername}</p>}
        {m.kind === "story_reply" && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/30 p-2 text-xs">
            <img src={m.storyImageUrl || ""} alt="Story" onLoad={onMediaLoad} className="h-14 w-12 rounded-lg object-cover" />
            <div className="min-w-0">
              <div className="flex items-center gap-1"><img src={m.senderAvatar || ""} alt="" className="h-5 w-5 rounded-full object-cover" /><span className="font-semibold">{m.senderUsername || "Friend"}</span></div>
              <span className="block">Replied to {m.storyOwnerId === meId ? "your" : `${m.storyOwnerName || "a friend"}’s`} story</span>
            </div>
          </div>
        )}
        {hasImage && <img src={m.imageUrl} alt="Shared" onLoad={onMediaLoad} onClick={() => onImage(m.imageUrl!)} className="block h-auto max-h-80 w-72 max-w-full cursor-zoom-in rounded-xl object-cover" />}
        {m.sharedPostId && (
          <button type="button" onClick={() => onPost(m)} className={`block w-full min-w-[14rem] overflow-hidden rounded-xl border text-left ${mine ? "border-white/30 bg-black/10" : "border-[#ead8cc] bg-[#fffaf6] text-[#3c2d26]"}`}>
            <div className="flex items-center gap-2 bg-white p-2 text-[#332720]">
              <Avatar src={preview?.profileimage} name={preview?.username || "Post owner"} size="h-8 w-8" />
              <span className="truncate text-xs font-bold">{preview?.username || "Shared post"}</span>
            </div>
            {preview?.imageUrl ? <img src={preview.imageUrl} alt="Post" onLoad={onMediaLoad} className="max-h-64 w-full object-cover" /> : <div className="grid h-24 place-items-center text-xs opacity-70"><ImageIcon size={20} /></div>}
            {preview?.caption && <p className="bg-white px-3 py-2 text-xs text-[#493c34]" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview.caption}</p>}
          </button>
        )}
        {m.text && <p className={`whitespace-pre-wrap break-words text-sm ${hasImage ? "px-3 pb-1 pt-1.5" : m.sharedPostId ? "mt-2" : ""}`}>{m.text}</p>}
        <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${hasImage ? "px-2 pb-1" : ""} ${mine ? "text-white/80" : "text-[#9d887b]"}`}>
          {messageTime(m.createdAt)} {mine && (seen ? <CheckCheck size={13} /> : <Check size={13} />)}
        </div>
      </div>
    </div>
  );
}

const Messages = () => {
  const { pathname } = useLocation();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const isPageActive = pathname === "/messages";
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const chatId = searchParams.get("chat");
  const [me, setMe] = useState<ProfileData | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [stories, setStories] = useState<StoryPerson[]>([]);
  const [friends, setFriends] = useState<Person[]>([]);
  const [active, setActive] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ file: File; preview: string } | null>(null);
  const [lightbox, setLightbox] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [showOptions, setShowOptions] = useState(false);
  const [background, setBackground] = useState("");
  const [bgUploading, setBgUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true); // true while the reader is at (or opening) the bottom of the chat
  const reloadTimer = useRef<number | undefined>(undefined);
  const refreshProfileAfterReload = useRef(false);
  const refreshListOnActivate = useRef(false);
  const refreshProfileOnActivate = useRef(false);
  const conversationListRequest = useRef<Promise<void> | null>(null);
  const landingRequest = useRef<Promise<void> | null>(null);

  // Refs let the shared socket handlers always see the latest state.
  const activeRef = useRef<ConversationRow | null>(null);
  const meRef = useRef<ProfileData | null>(null);
  const conversationsRef = useRef<ConversationRow[]>([]);
  const rowCache = useRef(new Map<string, ConversationRow>());
  useLayoutEffect(() => {
    meRef.current = me;
    conversationsRef.current = conversations;
  }, [me, conversations]);

  const applyConversationList = useCallback((data: { conversations: ConversationRow[]; stories: StoryPerson[] }) => {
    // Never allow two rows with the same conversationId (React key collisions).
    setConversations([...new Map(data.conversations.map((c) => [c.conversationId, c])).values()]);
    setStories(data.stories);
  }, []);

  const loadConversationList = useCallback(() => {
    if (conversationListRequest.current) return conversationListRequest.current;
    const request = Promise.resolve().then(async () => {
      setError("");
      try {
        const result = await api<ApiResult<{ conversations: ConversationRow[]; stories: StoryPerson[] }>>("/api/messages/conversations");
        applyConversationList(result.data);
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load messages."); }
      finally {
        if (conversationListRequest.current === request) conversationListRequest.current = null;
      }
    });
    conversationListRequest.current = request;
    return request;
  }, [applyConversationList, setError]);

  const loadLanding = useCallback(() => {
    if (landingRequest.current) return landingRequest.current;
    const request = Promise.resolve().then(async () => {
      setError("");
      try {
        const [profileResponse] = await Promise.all([
          profileService.getMyProfile(),
          loadConversationList(),
        ]);
        const own = profileResponse.data.profile;
        setMe(own);
        setFriends((own.friends || []).filter((f) => f.friendshipAccepted).map((f) => ({ userid: f.userid, username: f.username, profileimage: f.profileimage })));
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load messages."); }
      finally {
        setLoading(false);
        if (landingRequest.current === request) landingRequest.current = null;
      }
    });
    landingRequest.current = request;
    return request;
  }, [loadConversationList, setError]);

  /** Coalesces socket bursts and only reloads profile data for friend changes. */
  const loadSoon = useCallback((includeProfile = false) => {
    if (pathnameRef.current !== "/messages") {
      refreshListOnActivate.current = true;
      refreshProfileOnActivate.current ||= includeProfile;
      return;
    }
    refreshProfileAfterReload.current ||= includeProfile;
    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      if (pathnameRef.current !== "/messages") {
        refreshListOnActivate.current = true;
        refreshProfileOnActivate.current ||= refreshProfileAfterReload.current;
        refreshProfileAfterReload.current = false;
        return;
      }
      const shouldReloadProfile = refreshProfileAfterReload.current;
      refreshProfileAfterReload.current = false;
      if (shouldReloadProfile) void loadLanding();
      else void loadConversationList();
    }, 300);
  }, [loadConversationList, loadLanding]);

  useEffect(() => { void loadLanding(); return () => window.clearTimeout(reloadTimer.current); }, [loadLanding]);

  useEffect(() => {
    if (!isPageActive) return;
    const reloadProfile = refreshProfileOnActivate.current;
    if (!refreshListOnActivate.current && !reloadProfile) return;
    refreshListOnActivate.current = false;
    refreshProfileOnActivate.current = false;
    if (reloadProfile) void loadLanding();
    else void loadConversationList();
  }, [isPageActive, loadConversationList, loadLanding]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  const onListScroll = () => {
    const el = listRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };
  const onMediaLoad = useCallback(() => { if (pinnedRef.current) scrollToBottom(); }, [scrollToBottom]);

  // Opening a chat (or receiving a message while at the bottom) always lands on the newest message.
  useLayoutEffect(() => { if (pinnedRef.current) scrollToBottom(); }, [messages, pending, active?.conversationId, scrollToBottom]);

  const appendMessage = useCallback((incoming: ChatMessage) => {
    setMessages((old) => old.some((m) => m.messageId === incoming.messageId) ? old : [...old, incoming]);
  }, []);

  /** Keeps the conversation list (last message, unread badge, order) live without refetching. */
  const applyToList = useCallback((incoming: ChatMessage, viewing: boolean) => {
    if (!conversationsRef.current.some((c) => c.conversationId === incoming.conversationId)) {
      loadSoon();
      return;
    }
    const mine = incoming.senderUserId === meRef.current?.userid;
    const system = isSystem(incoming);
    setConversations((old) => {
      const row = old.find((c) => c.conversationId === incoming.conversationId);
      if (!row) return old;
      const updated = { ...row, lastMessage: previewOf(incoming), lastMessageAt: incoming.createdAt, unreadCount: viewing || mine ? 0 : system ? row.unreadCount : row.unreadCount + 1 };
      return [updated, ...old.filter((c) => c.conversationId !== incoming.conversationId)];
    });
  }, [loadSoon]);

  const loadChat = useCallback(async (row: ConversationRow) => {
    activeRef.current = row;
    pinnedRef.current = true;
    setActive(row); setMessages([]); setBackground(row.background || ""); setError("");
    try {
      const endpoint = row.type === "group"
        ? `/api/messages/groups/${encodeURIComponent(row.conversationId)}`
        : `/api/messages/conversation/${encodeURIComponent(row.person?.userid || row.conversationId.split(":").find((id) => id !== meRef.current?.userid) || "")}`;
      const result = await api<ApiResult<{ messages: ChatMessage[]; background?: string }>>(endpoint);
      if (activeRef.current?.conversationId !== row.conversationId) return; // user already left
      pinnedRef.current = true;
      setMessages(result.data.messages || []);
      setBackground(result.data.background || row.background || "");
      setConversations((old) => old.map((c) => c.conversationId === row.conversationId ? { ...c, unreadCount: 0 } : c));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load conversation."); }
  }, [setError]);

  /** The URL (?chat=) is the single source of truth for which chat is open. */
  const openChat = (row: ConversationRow) => {
    rowCache.current.set(row.conversationId, row);
    setSearchParams({ chat: row.conversationId });
  };

  const closeConversation = () => {
    activeRef.current = null;
    setActive(null); setMessages([]); setDraft(""); setPending(null); setShowOptions(false); setShowGroupInfo(false); setError("");
    navigate({ pathname: "/messages", search: "" }, { replace: true });
  };

  useEffect(() => {
    if (!chatId) {
      activeRef.current = null;
      // Keep the chat state in sync with browser back/forward navigation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(null); setMessages([]); setShowOptions(false); setShowGroupInfo(false); setDraft(""); setPending(null); setLightbox("");
      return;
    }
    if (!me || activeRef.current?.conversationId === chatId) return;
    const row = conversations.find((c) => c.conversationId === chatId) || rowCache.current.get(chatId);
    if (row) void loadChat(row);
  }, [chatId, me, conversations, loadChat]);

  // Keep the open group's name / photo / members in sync (and leave it if I was removed).
  useEffect(() => {
    const current = activeRef.current;
    if (!current || current.type !== "group" || loading) return;
    const row = conversations.find((c) => c.conversationId === current.conversationId);
    if (!row) { closeConversation(); return; }
    if (row.title !== current.title || row.photoUrl !== current.photoUrl || (row.members?.length || 0) !== (current.members?.length || 0)) {
      const next = { ...current, title: row.title, photoUrl: row.photoUrl, members: row.members };
      activeRef.current = next;
      setActive(next);
    }
  }, [conversations, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- Live updates (shared socket) ----------------
  useSocketEvent<ChatMessage>("message:new", (incoming) => {
    const current = activeRef.current;
    const sameConversation = current?.conversationId === incoming.conversationId;
    const viewing = isPageActive && sameConversation;
    if (sameConversation) {
      appendMessage(incoming);
      if (viewing && !isSystem(incoming) && incoming.senderUserId !== meRef.current?.userid) {
        void api(`/api/messages/${encodeURIComponent(incoming.conversationId)}/read`, { method: "POST" }).catch(() => undefined);
      }
    }
    applyToList(incoming, viewing);
  });
  useSocketEvent<{ conversationId: string; messageIds: string[]; readBy: string; readAt: string }>("message:read", (event) => {
    if (event.conversationId !== activeRef.current?.conversationId) return;
    const ids = new Set(event.messageIds);
    setMessages((old) => old.map((message) => ids.has(message.messageId)
      ? { ...message, readAt: event.readAt, readBy: [...new Set([...(message.readBy || []), event.readBy])] }
      : message));
  });
  useSocketEvent("conversation:updated", () => loadSoon());
  useSocketEvent("story:updated", () => loadSoon());
  useSocketEvent("friend:updated", () => loadSoon(true));
  useSocketEvent<{ userId?: string; actorId?: string }>("profile:updated", (event) => {
    if (event?.userId && event.userId !== meRef.current?.userid) loadSoon(true);
  });

  const clearPending = () => {
    setPending((old) => { if (old) URL.revokeObjectURL(old.preview); return null; });
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const chooseImage = (file?: File) => {
    if (!file) return;
    const problem = imageError(file);
    if (problem) { setError(problem); return; }
    setError("");
    setPending((old) => { if (old) URL.revokeObjectURL(old.preview); return { file, preview: URL.createObjectURL(file) }; });
  };

  const send = async () => {
    const text = draft.trim();
    if (!active || sending || (!text && !pending)) return;
    const recipientUserId = active.person?.userid || active.conversationId.split(":").find((id) => id && id !== me?.userid);
    if (active.type === "direct" && !recipientUserId) { setError("Could not identify the recipient. Go back and reopen this conversation."); return; }
    setSending(true); setError("");
    try {
      const imageUrl = pending ? await uploadImage(pending.file) : "";
      const body = active.type === "group" ? { groupId: active.conversationId, text, imageUrl } : { recipientUserId, text, imageUrl };
      const result = await api<ApiResult<{ messageId: string; conversationId: string; message: ChatMessage }>>("/api/messages/send", { method: "POST", body: JSON.stringify(body) });
      setDraft(""); clearPending();
      pinnedRef.current = true; // my own message always scrolls into view
      appendMessage(result.data.message); // the socket echo is de-duplicated by messageId
      applyToList(result.data.message, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send message.");
    } finally { setSending(false); }
  };

  const createGroup = async () => {
    try {
      const result = await api<ApiResult<{ conversationId: string }>>("/api/messages/groups", { method: "POST", body: JSON.stringify({ title: groupTitle, memberIds: selectedFriends }) });
      const title = groupTitle;
      setShowCreate(false); setGroupTitle(""); setSelectedFriends([]);
      await loadConversationList();
      openChat({ conversationId: result.data.conversationId, type: "group", title, lastMessage: "", unreadCount: 0 });
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create group."); }
  };

  const doChatSearch = async (value: string) => {
    setQuery(value);
    if (!value.trim()) { setSearchResults([]); return; }
    try {
      const result = await api<ApiResult<{ messages: ChatMessage[] }>>(`/api/messages/search?q=${encodeURIComponent(value)}`);
      setSearchResults(result.data.messages || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed."); }
  };

  const clearChat = async () => {
    if (!active) return;
    const ok = await confirm({
      title: "Clear this chat?",
      message: "It is cleared only for your account. Other people will still see their messages.",
      confirmText: "Clear chat",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/messages/${encodeURIComponent(active.conversationId)}/clear`, { method: "DELETE" });
      setMessages([]); setShowOptions(false);
      await loadConversationList();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to clear chat."); }
  };

  const saveBackground = async (value: string) => {
    if (!active) return;
    try {
      await api(`/api/messages/${encodeURIComponent(active.conversationId)}/background`, { method: "PATCH", body: JSON.stringify({ background: value }) });
      setBackground(value);
      setConversations((old) => old.map((c) => c.conversationId === active.conversationId ? { ...c, background: value } : c));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save background."); }
  };

  const uploadBackground = async (file?: File) => {
    if (!file || !active) return;
    const problem = imageError(file);
    if (problem) { setError(problem); return; }
    setBgUploading(true); setError("");
    try {
      const url = await uploadImage(file); // Cloudinary secure URL
      await saveBackground(`image:${url}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to upload background."); }
    finally { setBgUploading(false); if (bgInputRef.current) bgInputRef.current.value = ""; }
  };

  // "Add story" opens the same picker + editor as the + button on the profile photo.
  const { pickStory, storyElement } = useAddStory({
    onPublished: () => { void loadConversationList(); },
    onError: setError,
  });

  // ---- Story callbacks (the viewer itself lives in StoriesSection) ----
  const handleStoryViewed = (userid: string, storyId: string) =>
    setStories((old) => old.map((p) => p.userid === userid ? { ...p, stories: p.stories.map((s) => s.storyId === storyId ? { ...s, seen: true } : s) } : p));
  const handleStoryDeleted = (userid: string, storyId: string) =>
    setStories((old) => old.map((p) => p.userid === userid ? { ...p, stories: p.stories.filter((s) => s.storyId !== storyId) } : p).filter((p) => p.stories.length > 0));

  const filteredConversations = useMemo(() => conversations.filter((c) => `${c.title} ${c.lastMessage}`.toLowerCase().includes(query.toLowerCase())), [conversations, query]);
  const activeTitle = active?.type === "group" ? active.title : active?.person?.name || active?.person?.username || active?.title;
  const activeAvatar = active?.type === "group" ? active.photoUrl : active?.person?.profileimage;

  return (
    // The whole page scrolls (no inner scroll areas), so the list always uses the full width.
    <div className="fixed inset-x-0 top-16 bottom-16 z-30 overflow-y-auto bg-[#fffaf6] text-[#30241f]">
      <div className="mx-auto w-full max-w-[688px] px-3 py-3 sm:px-6 lg:px-0">
        {/* Search bar + New group button (above the stories) */}
        <div className={`mt-4 sm:mt-5 lg:mt-6 ${EDGE_SPACING}`}>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search size={17} className="absolute left-3 top-3 text-[#a58a7c]"/>
              <input value={query} onChange={(e) => void doChatSearch(e.target.value)} placeholder="Search people, conversations, messages..." className="w-full rounded-full border border-[#ebd9ce] bg-[#fffaf6] py-2.5 pl-9 pr-10 text-sm outline-none focus:border-[#bb7455]"/>
              {query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setSearchResults([]); }} className="absolute right-2 top-1.5 rounded-full p-1.5 text-[#9b7664] hover:bg-[#f5e4da]"><X size={16}/></button>}
            </div>
            <button type="button" aria-label="New group" onClick={() => setShowCreate(true)} className="flex shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-[#c77e5d] to-[#98452f] px-4 py-2.5 text-sm font-bold text-white shadow-sm"><Users size={17}/><span className="hidden sm:inline">New group</span></button>
          </div>
          {searchResults.length > 0 && <div className="mt-2 rounded-xl bg-[#fff6ef] p-2">{searchResults.slice(0, 8).map((m) => <button key={m.messageId} onClick={() => { const row = conversations.find((c) => c.conversationId === m.conversationId); if (row) openChat(row); }} className="block w-full border-b border-[#ead8cc] p-2 text-left text-xs last:border-b-0">{m.text || "Shared post"} <span className="block text-[#9c8173]">{ago(m.createdAt)}</span></button>)}</div>}
        </div>

        <StoriesSection
          stories={stories}
          meId={me?.userid}
          onAddStory={pickStory}
          onViewed={handleStoryViewed}
          onDeleted={handleStoryDeleted}
        />

        {/* Conversation list: transparent, no border, background or shadow */}
        <section className={`bg-transparent ${EDGE_SPACING}`}>
          <h2 className="mb-2 text-left font-bold">Messages</h2>
          {loading ? <p className="p-5 text-sm text-[#9c8173]">Loading conversations…</p> : filteredConversations.map((c) => (
            <button key={c.conversationId} onClick={() => openChat(c)} className="flex w-full items-center gap-3 rounded-2xl p-2 text-left transition hover:bg-[#fff4ed]">
              <Avatar src={c.type === "group" ? c.photoUrl : c.person?.profileimage} name={c.title}/>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{c.title}</span><span className="block truncate text-xs text-[#8d7a70]">{c.lastMessage || (c.type === "group" ? "Group conversation" : "Start a conversation")}</span></span>
              <span className="flex flex-col items-end gap-1">{c.lastMessageAt && <span className="text-[10px] text-[#a18c80]">{ago(c.lastMessageAt)}</span>}{c.unreadCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#a84f32] px-1 text-[10px] font-bold text-white">{c.unreadCount}</span>}</span>
            </button>
          ))}
          {!loading && filteredConversations.length === 0 && <div className="p-6 text-center text-sm text-[#9c8173]">No conversations found.</div>}
        </section>

        {error && <div className={`mt-3 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${EDGE_SPACING}`}><span>{error}</span><button onClick={() => setError("")}><X size={16}/></button></div>}
      </div>

      {active && (
        <ConversationSheet open background={background}>
          <header className="flex shrink-0 items-center gap-3 border-b border-[#f0e2d9] bg-white/95 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button type="button" aria-label="Back to messages" onClick={closeConversation} className="rounded-lg p-2 hover:bg-[#fff1e8]"><ArrowLeft size={19}/></button>
            <button type="button" disabled={active.type !== "group"} onClick={() => setShowGroupInfo(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <Avatar src={activeAvatar} name={activeTitle} size="h-10 w-10"/>
              <span className="min-w-0 flex-1"><span className="block truncate font-bold">{activeTitle}</span><span className="block text-xs text-[#927c70]">{active.type === "group" ? `${active.members?.length || 0} members · tap for group info` : "JobDrips friends"}</span></span>
            </button>
            <button onClick={() => setShowOptions((v) => !v)} className="rounded-xl p-2 hover:bg-[#fff1e8]"><MoreHorizontal size={20}/></button>
          </header>
          {showOptions && <div className="flex flex-wrap items-center gap-2 border-b border-[#f0e2d9] bg-white p-3 text-xs">
            {active.type === "group" && <button onClick={() => { setShowOptions(false); setShowGroupInfo(true); }} className="rounded-lg border border-[#e2c7b9] px-3 py-2 font-semibold">Group info</button>}
            <span className="font-semibold">Chat background:</span>
            {["", "#fffaf6", "#fce8dc", "#e8eee8", "#e9e9f9"].map((c) => <button key={c || "default"} title={c || "Default"} onClick={() => void saveBackground(c)} className="h-7 w-7 rounded-full border border-[#d8c3b6]" style={{ background: c || "#fffaf6" }}/>)}
            <input ref={bgInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void uploadBackground(e.target.files?.[0])}/>
            <button onClick={() => bgInputRef.current?.click()} disabled={bgUploading} className="flex items-center gap-1 rounded-lg border border-[#e2c7b9] px-3 py-2 disabled:opacity-50"><ImageIcon size={14}/>{bgUploading ? "Uploading…" : "Upload image"}</button>
            {background.startsWith("image:") && <button onClick={() => void saveBackground("")} className="rounded-lg border border-[#e2c7b9] px-3 py-2">Remove image</button>}
            <button onClick={() => void clearChat()} className="ml-auto rounded-lg border border-[#e2c7b9] px-3 py-2 text-[#9b4931]">Clear chat for me</button>
          </div>}
          <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-6">
            {messages.map((m, index) => {
              const dateLabel = messageDateLabel(m.createdAt);
              const previousDate = index > 0 ? messageDateLabel(messages[index - 1].createdAt) : "";
              return (
                <Fragment key={m.messageId}>
                  {dateLabel && dateLabel !== previousDate && (
                    <div className="flex justify-center py-1">
                      <span className="rounded-full bg-[#f3dfd4] px-5 py-2 text-sm font-bold text-[#814832] shadow-sm ring-1 ring-[#d8b5a2]">{dateLabel}</span>
                    </div>
                  )}
                  {isSystem(m)
                    ? <SystemNote m={m} meId={me?.userid} />
                    : <Bubble m={m} mine={m.senderUserId === me?.userid} meId={me?.userid} group={active.type === "group"} onImage={setLightbox} onPost={(post) => navigate(`/profile/${post.sharedPostOwnerId}/posts/${post.sharedPostId}`)} onMediaLoad={onMediaLoad} />}
                </Fragment>
              );
            })}
            {messages.length === 0 && <div className="grid h-full place-items-center text-center text-sm text-[#9b8578]">Say hello 👋</div>}
          </div>
          <div className="shrink-0 border-t border-[#f0e2d9] bg-white/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {pending && <div className="mb-2"><div className="relative inline-block"><img src={pending.preview} alt="Selected" className="h-28 max-w-[14rem] rounded-xl object-cover"/><button type="button" aria-label="Remove image" onClick={clearPending} className="absolute -right-2 -top-2 rounded-full bg-black/70 p-1 text-white"><X size={14}/></button></div></div>}
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => chooseImage(e.target.files?.[0])}/>
              <button type="button" title="Choose an image from your device" aria-label="Attach image" onClick={() => imageInputRef.current?.click()} disabled={sending} className="rounded-xl p-2 text-[#a65336] hover:bg-[#fff0e7] disabled:opacity-50"><Paperclip size={19}/></button>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={pending ? "Add a caption…" : "Write a message…"} className="max-h-28 min-h-11 flex-1 resize-y rounded-2xl border border-[#e8d5c9] bg-[#fffaf6] px-4 py-3 text-sm outline-none focus:border-[#b86f50]"/>
              <button type="submit" disabled={sending || (!draft.trim() && !pending)} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#ca8564] to-[#98452f] text-white disabled:cursor-not-allowed disabled:opacity-50"><Send size={18}/></button>
            </form>
          </div>
          {lightbox && <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/90 p-4" onClick={() => setLightbox("")}><button type="button" aria-label="Close image" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white" onClick={() => setLightbox("")}><X/></button><img src={lightbox} alt="Full size" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()}/></div>}
        </ConversationSheet>
      )}

      {showGroupInfo && active?.type === "group" && me && (
        <GroupInfoSheet
          conversationId={active.conversationId}
          meId={me.userid}
          friends={friends}
          onClose={() => setShowGroupInfo(false)}
          onChanged={() => loadSoon()}
          onLeft={() => { setShowGroupInfo(false); closeConversation(); void loadConversationList(); }}
        />
      )}

      {showCreate && <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"><div className="w-full max-w-md rounded-3xl bg-[#fffaf6] p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">Create group chat</h2><button onClick={() => setShowCreate(false)}><X/></button></div><label className="text-xs font-bold text-[#98715f]">GROUP NAME</label><input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} maxLength={80} placeholder="Project team" className="mb-4 mt-1 w-full rounded-xl border border-[#e8d5c9] bg-white px-3 py-3 outline-none focus:border-[#b86f50]"/><p className="mb-2 text-xs font-bold text-[#98715f]">CHOOSE 2–39 FRIENDS (GROUPS HOLD UP TO 40 PEOPLE)</p><div className="max-h-64 space-y-1 overflow-auto">{friends.map((f) => <label key={f.userid} className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-[#fff0e7]"><input type="checkbox" checked={selectedFriends.includes(f.userid)} onChange={(e) => setSelectedFriends((old) => e.target.checked ? [...old, f.userid] : old.filter((id) => id !== f.userid))}/><Avatar src={f.profileimage} name={f.username} size="h-9 w-9"/><span className="text-sm font-semibold">{f.username}</span></label>)}</div><button onClick={() => void createGroup()} disabled={!groupTitle.trim() || selectedFriends.length < 2 || selectedFriends.length > 39} className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#c77e5d] to-[#98452f] px-4 py-3 font-bold text-white disabled:opacity-50">Create group</button></div></div>}

      {storyElement}
      {dialog}
    </div>
  );
};

export default Messages;
