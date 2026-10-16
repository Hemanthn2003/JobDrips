import { useEffect, useRef, useState } from "react";
import { Heart, Pencil, Reply, Send, Trash2, X } from "lucide-react";
import {
  addComment,
  deleteComment,
  editComment,
  setCommentLike,
} from "../../services/postService";
import type {
  PostComment,
  PostData,
  PostPerson,
} from "../../services/postService";
import { useConfirm } from "../common/ConfirmModal";
import MentionField from "./MentionField";
import { PersonAvatar, RichText, timeAgoLong } from "./postUtils";

interface Props {
  post: PostData;
  viewer: PostPerson;
  onPostChange: (update: (post: PostData) => PostData) => void;
  /** Closes the bottom sheet. */
  onClose: () => void;
}

const byOldestFirst = (a: PostComment, b: PostComment) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

const errText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const iconButton =
  "flex h-7 items-center gap-1 rounded-full px-1.5 text-[11px] font-semibold text-[#9a897e] transition hover:bg-[#f5ece6] hover:text-[#654536] disabled:opacity-50";

export default function PostComments({ post, viewer, onPostChange, onClose }: Props) {
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ commentId: string; username: string } | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollToId = useRef<string>("");
  const opened = useRef(false);
  // True while the delete confirmation is open, so Esc only closes that.
  const confirming = useRef(false);

  // Oldest comments first (top), newest last (bottom).
  const comments = [...(post.comments ?? [])].sort(byOldestFirst);
  const topLevel = comments.filter((comment) => !comment.parentCommentId);
  const repliesOf = (id: string) =>
    comments.filter((comment) => comment.parentCommentId === id);

  // Always call the latest onClose without re-running the effect below.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Keep the page behind the sheet still while it is open, and close on Esc.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirming.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Opening the sheet jumps to the newest comment; posting a comment or a
  // reply scrolls to the one just added.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    if (scrollToId.current) {
      const target = list.querySelector(
        `[data-comment-id="${scrollToId.current}"]`,
      );
      scrollToId.current = "";
      if (target instanceof HTMLElement) {
        target.scrollIntoView({ block: "end", behavior: "smooth" });
        return;
      }
    }

    if (!opened.current) {
      opened.current = true;
      list.scrollTop = list.scrollHeight;
    }
  }, [comments.length]);

  // A comment needs words besides its @mentions.
  const hasContent = draft.replace(/@[A-Za-z0-9_.]+/g, "").trim().length > 0;

  const patchComment = (commentId: string, changes: Partial<PostComment>) =>
    onPostChange((current) => ({
      ...current,
      comments: (current.comments ?? []).map((comment) =>
        comment.commentId === commentId ? { ...comment, ...changes } : comment,
      ),
    }));

  const startReply = (comment: PostComment) => {
    setReplyTo({
      commentId: comment.parentCommentId || comment.commentId,
      username: comment.username,
    });
    setDraft(`@${comment.username} `);
    setFocusSignal((value) => value + 1);
  };

  const cancelReply = () => {
    setReplyTo(null);
    setDraft("");
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !hasContent || sending) return;

    setSending(true);
    setError("");

    try {
      const result = await addComment(
        post.userid,
        post.postId,
        text,
        replyTo?.commentId ?? null,
      );

      scrollToId.current = result.comment.commentId;
      onPostChange((current) => ({
        ...current,
        commentCount: result.commentCount,
        comments: [...(current.comments ?? []), result.comment],
      }));
      setDraft("");
      setReplyTo(null);
    } catch (err: unknown) {
      setError(errText(err, "Unable to post your comment."));
    } finally {
      setSending(false);
    }
  };

  const toggleLike = async (comment: PostComment) => {
    const liked = !comment.liked;

    patchComment(comment.commentId, {
      liked,
      likeCount: Math.max(0, comment.likeCount + (liked ? 1 : -1)),
    });

    try {
      const result = await setCommentLike(post.userid, post.postId, comment.commentId, liked);
      patchComment(comment.commentId, { liked: result.liked, likeCount: result.likeCount });
    } catch (err: unknown) {
      patchComment(comment.commentId, { liked: comment.liked, likeCount: comment.likeCount });
      setError(errText(err, "Unable to like this comment."));
    }
  };

  const saveEdit = async (comment: PostComment) => {
    const text = editText.trim();
    if (!text || busyId) return;

    setBusyId(comment.commentId);
    setError("");

    try {
      const result = await editComment(post.userid, post.postId, comment.commentId, text);
      patchComment(comment.commentId, {
        commentText: result.commentText,
        mentions: result.mentions,
        updatedAt: result.updatedAt,
        edited: true,
      });
      setEditingId("");
    } catch (err: unknown) {
      setError(errText(err, "Unable to edit this comment."));
    } finally {
      setBusyId("");
    }
  };

  const remove = async (comment: PostComment) => {
    if (busyId) return;

    confirming.current = true;
    const ok = await confirm({
      title: "Delete this comment?",
      message: "Replies to this comment will be deleted with it.",
      confirmText: "Delete",
      tone: "danger",
    });
    confirming.current = false;
    if (!ok) return;

    setBusyId(comment.commentId);
    setError("");

    try {
      const result = await deleteComment(post.userid, post.postId, comment.commentId);

      onPostChange((current) => ({
        ...current,
        commentCount: result.commentCount,
        comments: (current.comments ?? []).filter(
          (item) =>
            item.commentId !== comment.commentId &&
            item.parentCommentId !== comment.commentId,
        ),
      }));
    } catch (err: unknown) {
      setError(errText(err, "Unable to delete this comment."));
    } finally {
      setBusyId("");
    }
  };

  const renderComment = (comment: PostComment, isReply: boolean) => {
    const canEdit = comment.userId === viewer.userid;
    const canDelete = post.isOwner || canEdit;
    const editing = editingId === comment.commentId;

    return (
      <div
        key={comment.commentId}
        data-comment-id={comment.commentId}
        className={`flex gap-2.5 ${isReply ? "ml-9 mt-2.5" : "mt-3.5"}`}
      >
        <PersonAvatar
          src={comment.profileImage}
          name={comment.username || "User"}
          className={isReply ? "h-7 w-7" : "h-8 w-8"}
        />

        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <div className="flex">
                <MentionField
                  value={editText}
                  onChange={setEditText}
                  maxLength={1000}
                  onSubmit={() => void saveEdit(comment)}
                  focusSignal={1}
                  className="h-10 w-full rounded-xl border border-[#eee4dd] px-3 text-sm outline-none focus:border-[#b79d8a]"
                />
              </div>
              <div className="mt-1.5 flex gap-2 text-xs font-semibold">
                <button
                  type="button"
                  disabled={!editText.trim() || busyId === comment.commentId}
                  onClick={() => void saveEdit(comment)}
                  className="rounded-full bg-[#654536] px-3 py-1 text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId("")}
                  className="rounded-full px-3 py-1 text-[#8b7a70] hover:bg-[#f5ece6]"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="break-words text-sm leading-5 text-[#493c34]">
                <span className="mr-1.5 font-bold text-[#332720]">@{comment.username}</span>
                <span className="whitespace-pre-wrap">
                  <RichText text={comment.commentText} mentions={comment.mentions} />
                </span>
              </p>

              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="-ml-1.5 flex items-center">
                  <button
                    type="button"
                    onClick={() => void toggleLike(comment)}
                    aria-label={comment.liked ? "Unlike comment" : "Like comment"}
                    aria-pressed={comment.liked}
                    className={`${iconButton} ${comment.liked ? "text-[#c75151]" : ""}`}
                  >
                    <Heart size={14} fill={comment.liked ? "currentColor" : "none"} />
                    {comment.likeCount > 0 && comment.likeCount}
                  </button>

                  <button type="button" onClick={() => startReply(comment)} aria-label="Reply" className={iconButton}>
                    <Reply size={14} />
                    Reply
                  </button>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(comment.commentId);
                        setEditText(comment.commentText);
                      }}
                      aria-label="Edit comment"
                      className={iconButton}
                    >
                      <Pencil size={13} />
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      disabled={busyId === comment.commentId}
                      onClick={() => void remove(comment)}
                      aria-label="Delete comment"
                      className={iconButton}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <time dateTime={comment.createdAt} className="shrink-0 text-[11px] text-[#aa9b90]">
                  {timeAgoLong(comment.createdAt)}
                  {comment.edited ? " · edited" : ""}
                </time>
              </div>
            </>
          )}
        </div>
      </div>
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
        @keyframes jd-sheet-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>

      <section
        role="dialog"
        aria-modal="true"
        aria-label="Comments"
        style={{ animation: "jd-sheet-up 0.28s cubic-bezier(0.22, 1, 0.36, 1)" }}
        className="flex h-[80dvh] w-full max-w-lg flex-col rounded-t-3xl border border-[#eee4dd] bg-white shadow-2xl sm:h-[640px] sm:max-h-[88dvh] sm:rounded-3xl"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-[#f0e7e1] px-4 pb-3 pt-2.5">
          <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-[#e3d6cc] sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-[#332720]">
              Comments
              <span className="ml-1.5 text-sm font-semibold text-[#9a897e]">
                {post.commentCount}
              </span>
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close comments"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5ede8] text-[#654536]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Comments: oldest at the top, newest at the bottom */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {topLevel.length === 0 && (
            <p className="py-10 text-center text-sm text-[#9a897e]">
              No comments yet. Start the conversation.
            </p>
          )}

          {topLevel.map((comment) => (
            <div key={comment.commentId}>
              {renderComment(comment, false)}
              {repliesOf(comment.commentId).map((reply) => renderComment(reply, true))}
            </div>
          ))}
        </div>

        {/* Fixed mention + comment box */}
        <div className="shrink-0 border-t border-[#f0e7e1] bg-white px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
          {error && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {error}
            </p>
          )}

          {replyTo && (
            <p className="mb-1.5 flex items-center justify-between text-xs text-[#8b7a70]">
              <span>
                Replying to <b className="text-[#654536]">@{replyTo.username}</b>
              </span>
              <button type="button" onClick={cancelReply} className="font-semibold text-[#9a6e58]">
                Cancel
              </button>
            </p>
          )}

          <div className="flex items-center gap-2">
            <PersonAvatar src={viewer.profileimage} name={viewer.username} className="h-8 w-8" />

            <div className="flex min-w-0 flex-1 items-center rounded-full border border-[#eee4dd] bg-[#faf8f6] pl-3 pr-1 focus-within:border-[#b79d8a]">
              {!replyTo && (
                <span className="mr-1.5 shrink-0 text-sm font-bold text-[#654536]">@{viewer.username}</span>
              )}
              <MentionField
                value={draft}
                onChange={setDraft}
                maxLength={1000}
                placeholder={replyTo ? "Write a reply..." : "Write a comment..."}
                onSubmit={() => void submit()}
                focusSignal={focusSignal}
                className="h-10 w-full min-w-0 bg-transparent text-sm text-[#332720] outline-none placeholder:text-[#b2a399]"
              />
              <button
                type="button"
                disabled={!hasContent || sending}
                onClick={() => void submit()}
                aria-label="Post comment"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#654536] transition hover:bg-[#f0e5de] disabled:opacity-40"
              >
                <Send size={17} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {dialog}
    </div>
  );
}