import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  Image as ImageIcon,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Send,
  Share2,
  Smile,
} from "lucide-react";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

interface FeedAuthor {
  userid: string;
  username: string;
  name: string;
  profileimage: string;
}

interface FeedPost {
  postId: string;
  userid: string;
  createdAt: string;
  imageUrl?: {
    image1?: string;
    image2?: string;
    image3?: string;
    image4?: string;
    image5?: string;
  };
  captions?: {
    captionId?: string;
    content?: string;
  };
  likes?: Array<{
    likeId?: string;
    userId?: string;
  }>;
  comments?: Array<{
    commentId?: string;
    userId?: string;
    commentText?: string;
  }>;
  hashtags?: string[];
  visibility?: "public" | "friends" | "private";
  settings?: {
    hideLikeCount?: boolean;
    hideComments?: boolean;
    hideShareCount?: boolean;
  };
  author: FeedAuthor;
}

interface FeedResponse {
  success: boolean;
  message?: string;
  data?: {
    posts: FeedPost[];
    total: number;
  };
}

const getPostImages = (post: FeedPost): string[] => {
  const images = post.imageUrl;

  if (!images) return [];

  return [
    images.image1,
    images.image2,
    images.image3,
    images.image4,
    images.image5,
  ].filter((image): image is string => Boolean(image?.trim()));
};

const getTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);

  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000),
  );

  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() !== new Date().getFullYear()
      ? "numeric"
      : undefined,
  });
};

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "J";

const Feed = () => {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [savedPosts, setSavedPosts] = useState<Set<string>>(new Set());
  const [activeImages, setActiveImages] = useState<Record<string, number>>({});
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(
    new Set(),
  );
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>(
    {},
  );
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());

  const loadFeed = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/feed`, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      const result = (await response.json()) as FeedResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load your feed.");
      }

      setPosts(result.data?.posts ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while loading your feed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  const totalPosts = useMemo(() => posts.length, [posts]);

  const toggleSetValue = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    postId: string,
  ) => {
    setter((previous) => {
      const next = new Set(previous);

      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }

      return next;
    });
  };

  const changeImage = (postId: string, direction: -1 | 1, imageCount: number) => {
    setActiveImages((previous) => {
      const current = previous[postId] ?? 0;

      return {
        ...previous,
        [postId]: (current + direction + imageCount) % imageCount,
      };
    });
  };

  const handleShare = async (post: FeedPost) => {
    const url = `${window.location.origin}/profile/${post.userid}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${post.author.name || post.author.username} on JobDrips`,
          text: post.captions?.content || "Check out this JobDrips post.",
          url,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        window.alert("Profile link copied to clipboard.");
      } else {
        window.prompt("Copy this link:", url);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        window.alert("Unable to share this post right now.");
      }
    }
  };

  const handleCommentSubmit = (postId: string) => {
    const comment = (commentInputs[postId] || "").trim();

    if (!comment) return;

    window.alert(
      "Comment UI is ready. Comment persistence will be enabled when we add the backend comment API.",
    );

    setCommentInputs((previous) => ({
      ...previous,
      [postId]: "",
    }));
  };

  return (
    <main className="min-h-screen bg-[#faf8f6] pb-8 text-[#332720]">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.22em] text-[#a17b6c]">
              Your community
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-[#332720] sm:text-3xl">
              Your Feed
            </h1>
            <p className="mt-1 text-sm text-[#8b7a70]">
              Ideas, people, and progress worth sharing.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadFeed()}
            disabled={loading}
            aria-label="Refresh feed"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#eadfd8] bg-white text-[#795b4b] shadow-sm transition hover:bg-[#f3eae4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={loading ? "animate-spin" : ""}
            />
          </button>
        </header>

        {!loading && !error && (
          <div className="mb-5 flex items-center gap-2 text-xs font-medium text-[#8b7a70]">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {totalPosts} {totalPosts === 1 ? "post" : "posts"} in your feed
          </div>
        )}

        {loading && (
          <div className="space-y-5">
            {[1, 2].map((item) => (
              <div
                key={item}
                className="overflow-hidden rounded-2xl border border-[#eee4dd] bg-white shadow-sm"
              >
                <div className="flex animate-pulse items-center gap-3 p-4">
                  <div className="h-11 w-11 rounded-full bg-[#eee6e0]" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 rounded bg-[#eee6e0]" />
                    <div className="h-2.5 w-20 rounded bg-[#f4efeb]" />
                  </div>
                </div>
                <div className="aspect-[4/3] animate-pulse bg-[#f0e9e4]" />
                <div className="space-y-3 p-4">
                  <div className="h-3 w-full rounded bg-[#f0e9e4]" />
                  <div className="h-3 w-3/4 rounded bg-[#f0e9e4]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <section className="rounded-2xl border border-[#efdbd4] bg-white px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f8eae5] text-[#a05b47]">
              <RefreshCw size={23} />
            </div>
            <h2 className="text-lg font-bold">Your feed couldn't load</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8b7a70]">
              {error}
            </p>
            <button
              type="button"
              onClick={() => void loadFeed()}
              className="mt-5 rounded-xl bg-[#654536] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#503628]"
            >
              Try again
            </button>
          </section>
        )}

        {!loading && !error && posts.length === 0 && (
          <section className="rounded-2xl border border-[#eee4dd] bg-white px-6 py-14 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f3eae4] text-[#795b4b]">
              <ImageIcon size={26} />
            </div>
            <h2 className="text-lg font-bold">Your feed is just getting started</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#8b7a70]">
              Posts from your connections will appear here as your community
              grows.
            </p>
          </section>
        )}

        {!loading && !error && posts.length > 0 && (
          <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_270px] lg:items-start">
            <section className="min-w-0 space-y-5">
              {posts.map((post) => {
                const images = getPostImages(post);
                const currentImage = Math.min(
                  activeImages[post.postId] ?? 0,
                  Math.max(images.length - 1, 0),
                );
                const isLiked = likedPosts.has(post.postId);
                const isSaved = savedPosts.has(post.postId);
                const caption = post.captions?.content || "";
                const isExpanded = expandedCaptions.has(post.postId);
                const showComments = openComments.has(post.postId);
                const initialLikes = post.likes?.length ?? 0;
                const displayLikes = initialLikes + (isLiked ? 1 : 0);

                return (
                  <article
                    key={`${post.userid}-${post.postId}`}
                    className="overflow-hidden rounded-2xl border border-[#eee4dd] bg-white shadow-[0_5px_24px_rgba(67,43,29,0.045)]"
                  >
                    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
                      {post.author.profileimage ? (
                        <img
                          src={post.author.profileimage}
                          alt={post.author.name || post.author.username}
                          className="h-11 w-11 shrink-0 rounded-full border border-[#eee4dd] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eadbd0] text-sm font-bold text-[#654536]">
                          {getInitials(post.author.name || post.author.username)}
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-bold text-[#332720]">
                          {post.author.name || post.author.username}
                        </h2>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#9a897e]">
                          <span>@{post.author.username}</span>
                          {post.createdAt && (
                            <>
                              <span>·</span>
                              <time dateTime={post.createdAt}>
                                {getTimeAgo(post.createdAt)}
                              </time>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label="More post options"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#8b7a70] transition hover:bg-[#f7f1ed]"
                      >
                        <MoreHorizontal size={21} />
                      </button>
                    </div>

                    {images.length > 0 && (
                      <div className="relative overflow-hidden bg-[#f0eae5]">
                        <div className="relative flex aspect-[4/3] max-h-[600px] w-full items-center justify-center sm:aspect-[5/4]">
                          <img
                            key={`${post.postId}-${images[currentImage]}`}
                            src={images[currentImage]}
                            alt={`Post by ${post.author.name || post.author.username}${
                              images.length > 1
                                ? `, image ${currentImage + 1} of ${images.length}`
                                : ""
                            }`}
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />

                          {images.length > 1 && (
                            <>
                              <button
                                type="button"
                                aria-label="Previous image"
                                onClick={() =>
                                  changeImage(post.postId, -1, images.length)
                                }
                                className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#49352b] shadow-md backdrop-blur transition hover:bg-white"
                              >
                                <ChevronLeft size={21} />
                              </button>

                              <button
                                type="button"
                                aria-label="Next image"
                                onClick={() =>
                                  changeImage(post.postId, 1, images.length)
                                }
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
                                onClick={() =>
                                  setActiveImages((previous) => ({
                                    ...previous,
                                    [post.postId]: index,
                                  }))
                                }
                                className={`h-1.5 rounded-full transition-all ${
                                  currentImage === index
                                    ? "w-5 bg-[#795744]"
                                    : "w-1.5 bg-[#ddcec3] hover:bg-[#b79d8a]"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="px-4 pb-4 pt-3 sm:px-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              toggleSetValue(setLikedPosts, post.postId)
                            }
                            aria-label={isLiked ? "Unlike post" : "Like post"}
                            aria-pressed={isLiked}
                            className={`flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[#f8efeb] ${
                              isLiked
                                ? "text-[#c75151]"
                                : "text-[#6f574a]"
                            }`}
                          >
                            <Heart
                              size={22}
                              fill={isLiked ? "currentColor" : "none"}
                              strokeWidth={1.8}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              toggleSetValue(setOpenComments, post.postId)
                            }
                            aria-label="Open comments"
                            aria-expanded={showComments}
                            className="flex h-10 w-10 items-center justify-center rounded-full text-[#6f574a] transition hover:bg-[#f8efeb]"
                          >
                            <MessageCircle size={21} strokeWidth={1.8} />
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleShare(post)}
                            aria-label="Share post"
                            className="flex h-10 w-10 items-center justify-center rounded-full text-[#6f574a] transition hover:bg-[#f8efeb]"
                          >
                            <Share2 size={20} strokeWidth={1.8} />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            toggleSetValue(setSavedPosts, post.postId)
                          }
                          aria-label={isSaved ? "Unsave post" : "Save post"}
                          aria-pressed={isSaved}
                          className={`flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-[#f8efeb] ${
                            isSaved ? "text-[#654536]" : "text-[#6f574a]"
                          }`}
                        >
                          <Bookmark
                            size={21}
                            fill={isSaved ? "currentColor" : "none"}
                            strokeWidth={1.8}
                          />
                        </button>
                      </div>

                      {!post.settings?.hideLikeCount && (
                        <p className="mt-1 text-sm font-bold text-[#49352b]">
                          {displayLikes} {displayLikes === 1 ? "like" : "likes"}
                        </p>
                      )}

                      {caption && (
                        <div className="mt-2 text-sm leading-6 text-[#493c34]">
                          <span className="mr-1.5 font-bold text-[#332720]">
                            {post.author.username}
                          </span>
                          <span className="whitespace-pre-wrap break-words">
                            {isExpanded || caption.length <= 180
                              ? caption
                              : `${caption.slice(0, 180).trimEnd()}…`}
                          </span>

                          {caption.length > 180 && (
                            <button
                              type="button"
                              onClick={() =>
                                toggleSetValue(
                                  setExpandedCaptions,
                                  post.postId,
                                )
                              }
                              className="ml-1 font-semibold text-[#9a8172] hover:text-[#654536]"
                            >
                              {isExpanded ? "Show less" : "more"}
                            </button>
                          )}
                        </div>
                      )}

                      {post.hashtags && post.hashtags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
                          {post.hashtags.map((tag) => (
                            <button
                              key={`${post.postId}-${tag}`}
                              type="button"
                              onClick={() => {
                                window.alert(
                                  `Hashtag search for #${tag} will be added with the search feature.`,
                                );
                              }}
                              className="text-sm font-medium text-[#9a6e58] transition hover:text-[#654536]"
                            >
                              #{tag.replace(/^#/, "")}
                            </button>
                          ))}
                        </div>
                      )}

                      {!post.settings?.hideComments &&
                        (post.comments?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleSetValue(setOpenComments, post.postId)
                            }
                            className="mt-2 text-sm text-[#9a897e] hover:text-[#654536]"
                          >
                            View all {post.comments?.length} comments
                          </button>
                        )}

                      {showComments && !post.settings?.hideComments && (
                        <div className="mt-3 border-t border-[#f0e7e1] pt-3">
                          {(post.comments || []).map((comment) => (
                            <p
                              key={comment.commentId}
                              className="mb-2 break-words text-sm text-[#66564c]"
                            >
                              <span className="mr-2 font-semibold text-[#332720]">
                                {comment.userId || "User"}
                              </span>
                              {comment.commentText}
                            </p>
                          ))}

                          <form
                            className="mt-3 flex items-center gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              handleCommentSubmit(post.postId);
                            }}
                          >
                            <Smile
                              size={19}
                              className="shrink-0 text-[#9a897e]"
                            />
                            <input
                              type="text"
                              value={commentInputs[post.postId] || ""}
                              onChange={(event) =>
                                setCommentInputs((previous) => ({
                                  ...previous,
                                  [post.postId]: event.target.value,
                                }))
                              }
                              placeholder="Write a comment..."
                              maxLength={1000}
                              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-[#332720] outline-none placeholder:text-[#b2a399]"
                            />
                            <button
                              type="submit"
                              disabled={!(commentInputs[post.postId] || "").trim()}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#795744] transition hover:bg-[#f5ece6] disabled:opacity-40"
                              aria-label="Submit comment"
                            >
                              <Send size={17} />
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>

            <aside className="hidden space-y-4 lg:block">
              <section className="rounded-2xl border border-[#eee4dd] bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#a17b6c]">
                  JobDrips
                </p>
                <h2 className="mt-2 text-lg font-bold text-[#332720]">
                  Grow together.
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#8b7a70]">
                  Share what you are learning, discover new ideas, and connect
                  with people building their future.
                </p>
              </section>

              <section className="rounded-2xl border border-[#eee4dd] bg-white p-5 shadow-sm">
                <h2 className="text-sm font-bold text-[#49352b]">
                  Feed guidelines
                </h2>
                <ul className="mt-3 space-y-2.5 text-xs leading-5 text-[#8b7a70]">
                  <li>• Share useful ideas and projects.</li>
                  <li>• Give constructive feedback.</li>
                  <li>• Celebrate other people's progress.</li>
                </ul>
              </section>

              <p className="px-1 text-[11px] leading-5 text-[#aa9b90]">
                © {new Date().getFullYear()} JobDrips. All rights reserved.
              </p>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
};

export default Feed;