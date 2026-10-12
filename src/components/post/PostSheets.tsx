import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Search, X } from "lucide-react";
import {
  loadFriends,
  reportPost,
  sendMessage,
  sharePost,
  updatePost,
} from "../../services/postService";
import type { PostData, PostPerson } from "../../services/postService";
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
// Message one person (optionally tagging a post)
// --------------------------------------------------

export function MessageSheet({
  recipient,
  post,
  onClose,
}: {
  recipient: { userid: string; username: string; profileimage?: string };
  post?: PostData;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    const message = text.trim();
    if (sending || (!message && !post)) return;

    setSending(true);
    setError("");

    try {
      await sendMessage({
        recipientUserId: recipient.userid,
        text: message,
        sharedPostId: post?.postId,
        sharedPostOwnerId: post?.userid,
      });
      setSent(true);
      window.setTimeout(onClose, 1200);
    } catch (err: unknown) {
      setError(errText(err, "Unable to send your message."));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title="Message" onClose={onClose}>
      {sent ? (
        <div className="py-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Check size={24} />
          </span>
          <p className="mt-3 font-bold text-[#332720]">Message sent</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <PersonAvatar src={recipient.profileimage} name={recipient.username} className="h-11 w-11" />
            <p className="text-sm font-bold text-[#332720]">@{recipient.username}</p>
          </div>

          {post && (
            <div className="mt-3">
              <PostPreview post={post} />
            </div>
          )}

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Write a message..."
            className="mt-3 w-full resize-none rounded-xl border border-[#eee4dd] p-3 text-sm outline-none focus:border-[#b79d8a]"
          />

          {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}

          <button
            type="button"
            disabled={sending || (!text.trim() && !post)}
            onClick={() => void send()}
            className={`mt-4 w-full ${primaryButton}`}
          >
            {sending ? "Sending..." : "Send message"}
          </button>
        </>
      )}
    </Modal>
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
