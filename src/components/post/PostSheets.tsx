import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Search, Send, X } from "lucide-react";
import {
  getConversation,
  loadFriends,
  reportPost,
  sendMessage,
  sharePost,
  updatePost,
} from "../../services/postService";
import type {
  ChatMessage,
  PostData,
  PostPerson,
} from "../../services/postService";
import MentionField from "./MentionField";
import { PersonAvatar, getPostImages } from "./postUtils";

const errText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const primaryButton =
  "rounded-xl bg-[#654536] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#503628] disabled:cursor-not-allowed disabled:opacity-50";

// --------------------------------------------------
// Shared modal shell
// --------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[160] flex items-end justify-center bg-[#2D1D16]/55 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-[#eee4dd] bg-white p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[#332720]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5ede8] text-[#654536]"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function PostPreview({ post }: { post: PostData }) {
  const image = getPostImages(post)[0];
  const caption = post.captions?.content || "";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#eee4dd] bg-[#faf6f3] p-2.5">
      {image ? (
        <img src={image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="h-12 w-12 shrink-0 rounded-lg bg-[#eee6e0]" />
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-[#332720]">
          @{post.author.username}
        </p>
        <p className="truncate text-xs text-[#8b7a70]">{caption || "Post"}</p>
      </div>
    </div>
  );
}

// --------------------------------------------------
// Share a post with friends
// --------------------------------------------------

export function ShareSheet({
  post,
  onClose,
  onShared,
}: {
  post: PostData;
  onClose: () => void;
  onShared: (shareCount: number) => void;
}) {
  const [friends, setFriends] = useState<PostPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    loadFriends()
      .then((list) => {
        if (!cancelled) setFriends(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errText(err, "Unable to load your friends."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visible = friends.filter((friend) =>
    friend.username.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (selected.size === 0 || sending) return;
    setSending(true);
    setError("");

    try {
      const result = await sharePost(post.userid, post.postId, [...selected], text.trim());
      onShared(result.shareCount);
      setSent(true);
      window.setTimeout(onClose, 1200);
    } catch (err: unknown) {
      setError(errText(err, "Unable to send this post."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Send to friends" onClose={onClose}>
      {sent ? (
        <div className="py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={24} />
          </span>
          <p className="mt-3 font-bold text-[#332720]">Post sent</p>
        </div>
      ) : (
        <>
          <PostPreview post={post} />

          <label className="mt-4 flex items-center gap-2 rounded-xl border border-[#eee4dd] px-3">
            <Search size={16} className="text-[#9a897e]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search friends"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#b2a399]"
            />
          </label>

          <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto">
            {loading && <li className="py-6 text-center text-sm text-[#8b7a70]">Loading friends...</li>}
            {!loading && visible.length === 0 && (
              <li className="py-6 text-center text-sm text-[#8b7a70]">
                {friends.length === 0 ? "You have no friends to send this to yet." : "No friends match your search."}
              </li>
            )}
            {visible.map((friend) => {
              const checked = selected.has(friend.userid);

              return (
                <li key={friend.userid}>
                  <button
                    type="button"
                    onClick={() => toggle(friend.userid)}
                    aria-pressed={checked}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[#faf6f3]"
                  >
                    <PersonAvatar src={friend.profileimage} name={friend.username} className="h-10 w-10" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#332720]">
                      @{friend.username}
                    </span>
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                        checked ? "border-[#654536] bg-[#654536] text-white" : "border-[#d9cabf]"
                      }`}
                    >
                      {checked && <Check size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={500}
            placeholder="Write a message (optional)"
            className="mt-3 h-11 w-full rounded-xl border border-[#eee4dd] px-3 text-sm outline-none focus:border-[#b79d8a]"
          />

          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            disabled={selected.size === 0 || sending}
            onClick={() => void send()}
            className={`mt-4 w-full ${primaryButton}`}
          >
            {sending ? "Sending..." : selected.size > 1 ? `Send to ${selected.size} friends` : "Send"}
          </button>
        </>
      )}
    </Modal>
  );
}

// --------------------------------------------------
// Message one person: full chat history + composer (optionally tagging a post)
// --------------------------------------------------

const clockTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

const dayLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const startOfDay = (input: Date) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
};

const dayKey = (value: string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function MessageSheet({
  recipient,
  post,
  onClose,
}: {
  recipient: { userid: string; username: string; profileimage?: string };
  post?: PostData;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<PostData | undefined>(post);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      const history = await getConversation(recipient.userid);
      setMessages(history);
    } catch (err: unknown) {
      setError((current) => current || errText(err, "Unable to load your messages."));
    } finally {
      setLoading(false);
    }
  }, [recipient.userid]);

  // Load the history, then quietly check for new messages from them.
  useEffect(() => {
    void loadHistory();
    const timer = window.setInterval(() => void loadHistory(), 6000);
    return () => window.clearInterval(timer);
  }, [loadHistory]);

  // Keep the page behind the sheet still while it is open, and close on Esc.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Newest message at the bottom; follow it unless the person scrolled up.
  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, loading]);

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current =
      list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  };

  const send = async () => {
    const message = text.trim();
    if (sending || (!message && !attached)) return;

    setSending(true);
    setError("");

    try {
      await sendMessage({
        recipientUserId: recipient.userid,
        text: message,
        sharedPostId: attached?.postId,
        sharedPostOwnerId: attached?.userid,
      });
      setText("");
      setAttached(undefined);
      stickToBottom.current = true;
      await loadHistory();
    } catch (err: unknown) {
      setError(errText(err, "Unable to send your message."));
    } finally {
      setSending(false);
    }
  };

  const openSharedPost = (message: ChatMessage) => {
    if (!message.sharedPostId || !message.sharedPostOwnerId) return;
    onClose();
    navigate(
      `/profile/${encodeURIComponent(message.sharedPostOwnerId)}/posts/${encodeURIComponent(message.sharedPostId)}`,
    );
  };

  return (
    <div
      className="fixed inset-0 z-[170] flex items-end justify-center bg-[#2D1D16]/55 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <style>{`
        @keyframes jd-chat-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Chat with ${recipient.username}`}
        style={{ animation: "jd-chat-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)" }}
        className="flex h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl border border-[#eee4dd] bg-white shadow-2xl sm:h-[680px] sm:max-h-[90dvh] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[#f0e7e1] px-4 py-3">
          <PersonAvatar src={recipient.profileimage} name={recipient.username} className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[#332720]">@{recipient.username}</p>
            <p className="text-xs text-[#9a897e]">Friends</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5ede8] text-[#654536]"
          >
            <X size={18} />
          </button>
        </div>

        {/* History: oldest at the top, newest at the bottom */}
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#faf8f6] px-4 py-4"
        >
          {loading && <p className="py-10 text-center text-sm text-[#8b7a70]">Loading messages...</p>}

          {!loading && messages.length === 0 && (
            <div className="py-12 text-center">
              <PersonAvatar
                src={recipient.profileimage}
                name={recipient.username}
                className="mx-auto h-16 w-16"
              />
              <p className="mt-3 text-sm font-bold text-[#332720]">@{recipient.username}</p>
              <p className="mt-1 text-sm text-[#8b7a70]">No messages yet. Say hello!</p>
            </div>
          )}

          {messages.map((message, index) => {
            const mine = message.senderUserId !== recipient.userid;
            const previous = messages[index - 1];
            const newDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
            const isPostMessage = Boolean(message.sharedPostId && message.sharedPostOwnerId);

            return (
              <div key={message.messageId}>
                {newDay && (
                  <p className="my-3 text-center text-[11px] font-semibold text-[#aa9b90]">
                    {dayLabel(message.createdAt)}
                  </p>
                )}

                <div className={`mt-1.5 flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-5 ${
                      mine
                        ? "rounded-br-md bg-[#654536] text-white"
                        : "rounded-bl-md border border-[#eee4dd] bg-white text-[#332720]"
                    }`}
                  >
                    {message.text && (
                      <p className="whitespace-pre-wrap break-words">{message.text}</p>
                    )}

                    {isPostMessage && (
                      <button
                        type="button"
                        onClick={() => openSharedPost(message)}
                        className={`mt-1.5 block rounded-lg px-2.5 py-1.5 text-xs font-bold ${
                          mine ? "bg-white/15 text-white" : "bg-[#f5ede8] text-[#654536]"
                        }`}
                      >
                        View post
                      </button>
                    )}

                    <p
                      className={`mt-1 text-right text-[10px] ${
                        mine ? "text-white/65" : "text-[#aa9b90]"
                      }`}
                    >
                      {clockTime(message.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fixed composer */}
        <div className="shrink-0 border-t border-[#f0e7e1] bg-white px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
          {attached && (
            <div className="mb-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <PostPreview post={attached} />
              </div>
              <button
                type="button"
                onClick={() => setAttached(undefined)}
                aria-label="Remove attached post"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5ede8] text-[#654536]"
              >
                <X size={15} />
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              maxLength={2000}
              placeholder="Write a message..."
              className="h-11 min-w-0 flex-1 rounded-full border border-[#eee4dd] bg-[#faf8f6] px-4 text-sm outline-none placeholder:text-[#b2a399] focus:border-[#b79d8a]"
            />
            <button
              type="button"
              disabled={sending || (!text.trim() && !attached)}
              onClick={() => void send()}
              aria-label="Send message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#654536] text-white transition hover:bg-[#503628] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------
// Report a post
// --------------------------------------------------

export function ReportSheet({
  post,
  onClose,
  onReported,
}: {
  post: PostData;
  onClose: () => void;
  /** Called two seconds after the report is saved. */
  onReported: () => void;
}) {
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(onReported, 2000);
    return () => window.clearTimeout(timer);
  }, [done, onReported]);

  const submit = async () => {
    if (sending || reason.trim().length < 3) return;
    setSending(true);
    setError("");

    try {
      await reportPost(post.userid, post.postId, reason.trim());
      setDone(true);
    } catch (err: unknown) {
      setError(errText(err, "Unable to submit your report."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Report post" onClose={done ? onReported : onClose}>
      {done ? (
        <div className="py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={24} />
          </span>
          <p className="mt-3 font-bold text-[#332720]">Report submitted</p>
          <p className="mt-1 text-sm text-[#8b7a70]">Thanks for letting us know. This post is now hidden for you.</p>
        </div>
      ) : (
        <>
          <PostPreview post={post} />
          <label className="mt-4 block text-sm font-semibold text-[#49352b]">
            What is wrong with this post?
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Describe the problem..."
              className="mt-2 w-full resize-none rounded-xl border border-[#eee4dd] p-3 text-sm font-normal outline-none focus:border-[#b79d8a]"
            />
          </label>

          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            disabled={sending || reason.trim().length < 3}
            onClick={() => void submit()}
            className="mt-4 w-full rounded-xl bg-[#b4432f] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#9a3826] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "Reporting..." : "Report"}
          </button>
        </>
      )}
    </Modal>
  );
}

// --------------------------------------------------
// Edit a post (owner)
// --------------------------------------------------

export function EditPostSheet({
  post,
  onClose,
  onSaved,
}: {
  post: PostData;
  onClose: () => void;
  onSaved: (changes: Pick<PostData, "captions" | "hashtags" | "mentions" | "settings">) => void;
}) {
  const [caption, setCaption] = useState(post.captions?.content ?? "");
  const [hashtags, setHashtags] = useState(post.hashtags.map((tag) => `#${tag}`).join(" "));
  const [settings, setSettings] = useState(post.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const flip = (key: keyof typeof settings) =>
    setSettings((previous) => ({ ...previous, [key]: !previous[key] }));

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");

    try {
      const result = await updatePost(post.userid, post.postId, {
        caption,
        hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
        settings,
      });
      onSaved(result);
      onClose();
    } catch (err: unknown) {
      setError(errText(err, "Unable to save your changes."));
    } finally {
      setSaving(false);
    }
  };

  // The checkboxes read "show ..."; the stored flags are "hide ...".
  const options: Array<{ key: keyof typeof settings; label: string; inverted: boolean }> = [
    { key: "hideLikeCount", label: "Show like count", inverted: true },
    { key: "hideSaveCount", label: "Show save count", inverted: true },
    { key: "hideShareCount", label: "Show share count", inverted: true },
    { key: "hideComments", label: "Turn off comments", inverted: false },
  ];

  return (
    <Modal title="Edit post" onClose={onClose}>
      <label className="block text-sm font-semibold text-[#49352b]">
        Caption
        <div className="mt-2 flex">
          <MentionField
            multiline
            rows={4}
            value={caption}
            onChange={setCaption}
            maxLength={5000}
            placeholder="Write a caption... use @ to mention friends"
            className="w-full resize-none rounded-xl border border-[#eee4dd] p-3 text-sm font-normal outline-none focus:border-[#b79d8a]"
          />
        </div>
      </label>

      <label className="mt-4 block text-sm font-semibold text-[#49352b]">
        Hashtags
        <input
          value={hashtags}
          onChange={(event) => setHashtags(event.target.value)}
          placeholder="#mern #react"
          className="mt-2 h-11 w-full rounded-xl border border-[#eee4dd] px-3 text-sm font-normal outline-none focus:border-[#b79d8a]"
        />
      </label>

      <div className="mt-4 space-y-2">
        {options.map((option) => {
          const checked = option.inverted ? !settings[option.key] : settings[option.key];

          return (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#eee4dd] px-3 py-3"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => flip(option.key)}
                className="h-4 w-4 accent-[#654536]"
              />
              <span className="text-sm font-semibold text-[#49352b]">{option.label}</span>
            </label>
          );
        })}
      </div>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className={`mt-4 w-full ${primaryButton}`}
      >
        {saving ? "Saving..." : "Save changes"}
      </button>
    </Modal>
  );
}
