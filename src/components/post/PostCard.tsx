import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Flag,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import {
  archivePost,
  deletePost,
  setLike,
  setSave,
} from "../../services/postService";
import type { PostData, PostPerson } from "../../services/postService";
import PostComments from "./PostComments";
import { EditPostSheet, MessageSheet, ReportSheet, ShareSheet } from "./PostSheets";
import { MEDAL_ACTIVE_ICON, MEDAL_ICON } from "./postAssets";
import {
  PersonAvatar,
  RichText,
  getPostImages,
  timeAgoShort,
} from "./postUtils";

interface Props {
  initialPost: PostData;
  viewer: PostPerson;
  /** Called when the post is deleted or reported (so the page can drop it). */
  onRemoved?: (postId: string) => void;
}

const errText = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

function ActionButton({
  label,
  count,
  active = false,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="flex min-w-[48px] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition hover:bg-[#f8efeb]"
    >
      {children}
      <span className="h-4 text-[11px] font-semibold leading-4 text-[#7b675b]">
        {count === undefined ? "" : count}
      </span>
    </button>
  );
}

export default function PostCard({ initialPost, viewer, onRemoved }: Props) {
  const navigate = useNavigate();
  const [post, setPost] = useState(initialPost);
  const [imageIndex, setImageIndex] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<"share" | "report" | "message" | "edit" | null>(null);
  const [burst, setBurst] = useState(0);
  const [error, setError] = useState("");
  const lastTap = useRef(0);
  const burstTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(burstTimer.current);
    },
    [],
  );

  const images = getPostImages(post);
  const currentImage = Math.min(imageIndex, Math.max(images.length - 1, 0));
  const caption = post.captions?.content ?? "";
  const { settings, isOwner } = post;

  // Counts hidden by the owner stay visible to the owner.
  const showLikeCount = isOwner || !settings.hideLikeCount;
  const showSaveCount = isOwner || !settings.hideSaveCount;
  const showShareCount = isOwner || !settings.hideShareCount;
  const commentsEnabled = !settings.hideComments;

  const update = (change: (current: PostData) => PostData) => setPost(change);

  // Tapping the photo / name at the top opens that person's profile.
  const openAuthorProfile = () => {
    if (isOwner || post.author.userid === viewer.userid) {
      navigate("/profile");
      return;
    }
    navigate(`/profile/${encodeURIComponent(post.author.userid)}`);
  };

  // Big medal that shows for one second on the photo.
  const triggerBurst = () => {
    window.clearTimeout(burstTimer.current);
    setBurst((value) => value + 1);
    burstTimer.current = window.setTimeout(() => setBurst(0), 1000);
  };

  const applyLike = async (liked: boolean) => {
    if (post.liked === liked) return;

    const previous = post;
    update((current) => ({
      ...current,
      liked,
      likeCount: Math.max(0, current.likeCount + (liked ? 1 : -1)),
    }));

    try {
      const result = await setLike(post.userid, post.postId, liked);
      update((current) => ({ ...current, liked: result.liked, likeCount: result.likeCount }));
    } catch (err: unknown) {
      setPost(previous);
      setError(errText(err, "Unable to update your like."));
    }
  };

  const handleMedalClick = () => {
    const liked = !post.liked;
    if (liked) triggerBurst();
    void applyLike(liked);
  };

  // Double tap / double click on the photo likes the post.
  const handleImageClick = () => {
    const now = Date.now();

    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      triggerBurst();
      void applyLike(true);
    } else {
      lastTap.current = now;
    }
  };

  const toggleSave = async () => {
    const saved = !post.saved;
    const previous = post;

    update((current) => ({
      ...current,
      saved,
      saveCount: Math.max(0, current.saveCount + (saved ? 1 : -1)),
    }));

    try {
      const result = await setSave(post.userid, post.postId, saved);
      update((current) => ({ ...current, saved: result.saved, saveCount: result.saveCount }));
    } catch (err: unknown) {
      setPost(previous);
      setError(errText(err, "Unable to save this post."));
    }
  };

  const toggleArchive = async () => {
    setMenuOpen(false);

    try {
      await archivePost(post.userid, post.postId, !post.archived);
      update((current) => ({ ...current, archived: !current.archived }));
    } catch (err: unknown) {
      setError(errText(err, "Unable to archive this post."));
    }
  };

  const remove = async () => {
    setMenuOpen(false);
    if (!window.confirm("Delete this post permanently?")) return;

    try {
      await deletePost(post.userid, post.postId);
      onRemoved?.(post.postId);
    } catch (err: unknown) {
      setError(errText(err, "Unable to delete this post."));
    }
  };

  const openSheet = (name: "share" | "report" | "message" | "edit") => {
    setMenuOpen(false);
    setSheet(name);
  };

  const menuItem =
    "flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-[#49352b] hover:bg-[#f8f1ec]";

  return (
    <article className="overflow-hidden rounded-2xl border border-[#eee4dd] bg-white shadow-[0_5px_24px_rgba(67,43,29,0.045)]">
      <style>{`
        @keyframes jd-medal-pop {
          0% { transform: scale(0.3); opacity: 0; }
          25% { transform: scale(1.15); opacity: 1; }
          45% { transform: scale(1); opacity: 1; }
          80% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.2); opacity: 0; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
        <button
          type="button"
          onClick={openAuthorProfile}
          aria-label={`Open ${post.author.username}'s profile`}
          className="shrink-0 rounded-full transition active:opacity-70"
        >
          <PersonAvatar
            src={post.author.profileimage}
            name={post.author.name || post.author.username}
            className="h-11 w-11"
          />
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold text-[#332720]">
            <button
              type="button"
              onClick={openAuthorProfile}
              className="max-w-full truncate text-left hover:underline"
            >
              {post.author.name || post.author.username}
            </button>
          </h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#9a897e]">
            <button
              type="button"
              onClick={openAuthorProfile}
              className="hover:underline"
            >
              @{post.author.username}
            </button>
            {post.createdAt && (
              <>
                <span>·</span>
                <time dateTime={post.createdAt}>{timeAgoShort(post.createdAt)}</time>
              </>
            )}
            {post.archived && (
              <span className="rounded-full bg-[#f3eae4] px-2 py-0.5 text-[10px] font-bold text-[#795b4b]">
                Archived
              </span>
            )}
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="More post options"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8b7a70] transition hover:bg-[#f7f1ed]"
          >
            <MoreHorizontal size={21} />
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-10 z-30 w-48 overflow-hidden rounded-xl border border-[#eee4dd] bg-white py-1 shadow-lg">
                {isOwner ? (
                  <>
                    <button type="button" className={menuItem} onClick={() => openSheet("edit")}>
                      <Pencil size={16} /> Edit
                    </button>
                    <button type="button" className={menuItem} onClick={() => void toggleArchive()}>
                      <Archive size={16} /> {post.archived ? "Unarchive" : "Archive"}
                    </button>
                    <button
                      type="button"
                      className={`${menuItem} text-red-600`}
                      onClick={() => void remove()}
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className={menuItem} onClick={() => openSheet("message")}>
                      <MessageSquare size={16} /> Message
                    </button>
                    <button
                      type="button"
                      className={`${menuItem} text-red-600`}
                      onClick={() => openSheet("report")}
                    >
                      <Flag size={16} /> Report
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Photos */}
      {images.length > 0 && (
        <div className="relative overflow-hidden bg-[#f0eae5]">
          <div
            onClick={handleImageClick}
            style={{ touchAction: "manipulation" }}
            className="relative flex aspect-[4/3] max-h-[600px] w-full cursor-pointer select-none items-center justify-center sm:aspect-[5/4]"
          >
            <img
              key={`${post.postId}-${images[currentImage]}`}
              src={images[currentImage]}
              alt={`Post by ${post.author.name || post.author.username}`}
              draggable={false}
              className="h-full w-full object-contain"
              loading="lazy"
            />

            {burst > 0 && (
              <img
                key={burst}
                src={MEDAL_ACTIVE_ICON}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-32 w-32 -ml-16 -mt-16 drop-shadow-xl"
                style={{ animation: "jd-medal-pop 1s ease-out forwards" }}
              />
            )}

            {images.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous image"
                  onClick={(event) => {
                    event.stopPropagation();
                    setImageIndex((currentImage - 1 + images.length) % images.length);
                  }}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#49352b] shadow-md backdrop-blur transition hover:bg-white"
                >
                  <ChevronLeft size={21} />
                </button>
                <button
                  type="button"
                  aria-label="Next image"
                  onClick={(event) => {
                    event.stopPropagation();
                    setImageIndex((currentImage + 1) % images.length);
                  }}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#49352b] shadow-md backdrop-blur transition hover:bg-white"
                >
                  <ChevronRight size={21} />
                </button>
                <span className="absolute right-3 top-3 rounded-full bg-[#2b211bcc] px-2.5 py-1 text-[11px] font-semibold text-white">
                  {currentImage + 1} / {images.length}
                </span>
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 bg-white py-3">
              {images.map((_, index) => (
                <button
                  key={`${post.postId}-dot-${index}`}
                  type="button"
                  aria-label={`Show image ${index + 1}`}
                  aria-current={currentImage === index}
                  onClick={() => setImageIndex(index)}
                  className={`h-1.5 rounded-full transition-all ${
                    currentImage === index ? "w-5 bg-[#795744]" : "w-1.5 bg-[#ddcec3] hover:bg-[#b79d8a]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="px-4 pb-4 pt-2 sm:px-5">
        {/* Actions with counts under each icon */}
        <div className="flex items-start justify-between">
          <div className="-ml-2 flex items-start">
            <ActionButton
              label={post.liked ? "Remove like" : "Like post"}
              active={post.liked}
              count={showLikeCount ? post.likeCount : undefined}
              onClick={handleMedalClick}
            >
              <img
                src={post.liked ? MEDAL_ACTIVE_ICON : MEDAL_ICON}
                alt=""
                className="h-6 w-6"
              />
            </ActionButton>

            {commentsEnabled && (
              <ActionButton
                label="Comments"
                active={showComments}
                count={post.commentCount}
                onClick={() => setShowComments(true)}
              >
                <MessageCircle size={22} strokeWidth={1.8} className="text-[#6f574a]" />
              </ActionButton>
            )}

            <ActionButton
              label="Send to friends"
              count={showShareCount ? post.shareCount : undefined}
              onClick={() => setSheet("share")}
            >
              <Send size={21} strokeWidth={1.8} className="text-[#6f574a]" />
            </ActionButton>
          </div>

          <div className="-mr-2">
            <ActionButton
              label={post.saved ? "Unsave post" : "Save post"}
              active={post.saved}
              count={showSaveCount ? post.saveCount : undefined}
              onClick={() => void toggleSave()}
            >
              <Bookmark
                size={22}
                strokeWidth={1.8}
                fill={post.saved ? "currentColor" : "none"}
                className={post.saved ? "text-[#654536]" : "text-[#6f574a]"}
              />
            </ActionButton>
          </div>
        </div>

        {post.archived && isOwner && (
          <p className="mt-2 text-xs font-medium text-[#9a897e]">
            Archived: only you can see this post.
          </p>
        )}

        {caption && (
          <div className="mt-2 text-sm leading-6 text-[#493c34]">
            <span className="mr-1.5 font-bold text-[#332720]">{post.author.username}</span>
            <span className="whitespace-pre-wrap break-words">
              <RichText
                text={expanded || caption.length <= 180 ? caption : `${caption.slice(0, 180).trimEnd()}…`}
              />
            </span>

            {caption.length > 180 && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="ml-1 font-semibold text-[#9a8172] hover:text-[#654536]"
              >
                {expanded ? "Show less" : "more"}
              </button>
            )}
          </div>
        )}

        {post.hashtags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
            {post.hashtags.map((tag) => (
              <button
                key={`${post.postId}-${tag}`}
                type="button"
                onClick={() =>
                  window.alert(`Hashtag search for #${tag} will be added with the search feature.`)
                }
                className="text-sm font-medium text-[#9a6e58] transition hover:text-[#654536]"
              >
                #{tag.replace(/^#/, "")}
              </button>
            ))}
          </div>
        )}

        {commentsEnabled && !showComments && post.commentCount > 0 && (
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="mt-2 text-sm text-[#9a897e] hover:text-[#654536]"
          >
            View all {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </button>
        )}

        {commentsEnabled && showComments && (
          <PostComments
            post={post}
            viewer={viewer}
            onPostChange={update}
            onClose={() => setShowComments(false)}
          />
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>

      {sheet === "share" && (
        <ShareSheet
          post={post}
          onClose={() => setSheet(null)}
          onShared={(shareCount) => update((current) => ({ ...current, shareCount }))}
        />
      )}

      {sheet === "message" && (
        <MessageSheet
          post={post}
          recipient={{
            userid: post.author.userid,
            username: post.author.username,
            profileimage: post.author.profileimage,
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === "report" && (
        <ReportSheet
          post={post}
          onClose={() => setSheet(null)}
          onReported={() => {
            setSheet(null);
            onRemoved?.(post.postId);
          }}
        />
      )}

      {sheet === "edit" && (
        <EditPostSheet
          post={post}
          onClose={() => setSheet(null)}
          onSaved={(changes) => update((current) => ({ ...current, ...changes }))}
        />
      )}
    </article>
  );
}
