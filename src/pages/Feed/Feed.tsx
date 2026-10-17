import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Image as ImageIcon, RefreshCw, Sparkles } from "lucide-react";
import PostCard from "../../components/post/PostCard";
import { getFeed } from "../../services/postService";
import type { PostData, PostPerson } from "../../services/postService";
import { useSocketEvent } from "../../lib/socket";

/** The server adds where a post came from. */
type FeedPost = PostData & {
  source?: "own" | "friend" | "suggested";
  reason?: "similar" | "friends_liked";
};

interface PendingFeed {
  posts: FeedPost[];
  viewer: PostPerson;
  freshCount: number;
}

/** Scrolled further than this = don't move the page, show the "new posts" button. */
const SCROLLED_DOWN_PX = 300;

/** Small stable fingerprint, so only posts that really changed are re-rendered fresh. */
const fingerprint = (post: PostData): number => {
  const text = JSON.stringify(post);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
};

const idOf = (post: PostData) => `${post.userid}-${post.postId}`;
const timeOf = (post: PostData) => new Date(post.createdAt || 0).getTime();

const Feed = () => {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [viewer, setViewer] = useState<PostPerson | null>(null);
  const [pending, setPending] = useState<PendingFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloadTimer = useRef<number | undefined>(undefined);
  const inFlightLoad = useRef<Promise<void> | null>(null);
  const refreshAfterLoad = useRef(false);
  const loadFeedRef = useRef<(silent?: boolean) => Promise<void>>(
    () => Promise.resolve(),
  );
  const postsRef = useRef<FeedPost[]>([]);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  // silent = refresh in the background (no skeleton, errors ignored).
  const loadFeed = useCallback((silent = false): Promise<void> => {
    if (inFlightLoad.current) return inFlightLoad.current;

    const pendingLoad = (async () => {
      try {
        const result = await getFeed();
        const incoming = result.posts as FeedPost[];
        if (!silent) setError("");

        if (silent) {
          // Posts that are newer than everything on screen.
          const current = postsRef.current;
          const known = new Set(current.map(idOf));
          const newest = current.reduce((max, post) => Math.max(max, timeOf(post)), 0);
          const fresh = incoming.filter(
            (post) => !known.has(idOf(post)) && timeOf(post) > newest,
          );

          // Reading further down: don't move the page, offer a button instead.
          if (fresh.length > 0 && window.scrollY > SCROLLED_DOWN_PX) {
            setPending({ posts: incoming, viewer: result.viewer, freshCount: fresh.length });
            return;
          }
        }

        setPending(null);
        setPosts(incoming);
        setViewer(result.viewer);
      } catch (err) {
        if (!silent) {
          setError(
            err instanceof Error
              ? err.message
              : "Something went wrong while loading your feed.",
          );
        }
      } finally {
        if (!silent) setLoading(false);
      }
    })();
    inFlightLoad.current = pendingLoad;
    void pendingLoad.then(
      () => {
        if (inFlightLoad.current === pendingLoad) {
          inFlightLoad.current = null;
          if (refreshAfterLoad.current) {
            refreshAfterLoad.current = false;
            void loadFeedRef.current(true);
          }
        }
      },
      () => {
        if (inFlightLoad.current === pendingLoad) {
          inFlightLoad.current = null;
          if (refreshAfterLoad.current) {
            refreshAfterLoad.current = false;
            void loadFeedRef.current(true);
          }
        }
      },
    );
    return pendingLoad;
  }, []);

  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  // New posts may enter this viewer's feed; changes to existing feed posts
  // only refresh this feed when that post is already present.
  useSocketEvent<{
    ownerId?: string;
    postId?: string;
    action?: string;
  }>("feed:updated", (payload) => {
    const isNewPost = payload?.action === "create";
    const isInFeed = postsRef.current.some(
      (post) => post.userid === payload?.ownerId && post.postId === payload?.postId,
    );
    if (!isNewPost && !isInFeed) return;

    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      if (inFlightLoad.current) {
        refreshAfterLoad.current = true;
      } else {
        void loadFeed(true);
      }
    }, 350);
  });

  const showPending = () => {
    if (!pending) return;
    setPosts(pending.posts);
    setViewer(pending.viewer);
    setPending(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const removePost = useCallback((postId: string) => {
    setPosts((previous) => previous.filter((post) => post.postId !== postId));
  }, []);

  return (
    <main className="min-h-screen w-full bg-[#faf8f6] pb-8 text-[#332720]">
      {pending && (
        <button
          type="button"
          onClick={showPending}
          className="fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:opacity-95 active:scale-95"
        >
          <ArrowUp size={16} />
          {pending.freshCount} new {pending.freshCount === 1 ? "post" : "posts"}
        </button>
      )}

      {/* Mobile: no side padding, cards touch both screen edges.
          Larger screens: normal side padding. */}
      <div className="mx-auto w-full max-w-[688px] px-0 py-3 sm:px-6 sm:py-5">
        {loading && (
          <div className="w-full space-y-3 sm:space-y-5">
            {[1, 2].map((item) => (
              <div
                key={item}
                className="w-full overflow-hidden border-y border-[#eee4dd] bg-white sm:rounded-2xl sm:border"
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
          <section className="mx-auto w-full max-w-xl rounded-2xl border border-[#efdbd4] bg-white px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#f8eae5] text-[#a05b47]">
              <RefreshCw size={23} />
            </div>
            <h2 className="text-lg font-bold">Your feed couldn't load</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8b7a70]">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError("");
                void loadFeed();
              }}
              className="mt-5 rounded-xl bg-[#654536] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#503628]"
            >
              Try again
            </button>
          </section>
        )}

        {!loading && !error && posts.length === 0 && (
          <section className="mx-auto w-full max-w-xl rounded-2xl border border-[#eee4dd] bg-white px-6 py-14 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#f3eae4] text-[#795b4b]">
              <ImageIcon size={26} />
            </div>
            <h2 className="text-lg font-bold">Your feed is just getting started</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#8b7a70]">
              Posts from you, your connections and people with similar
              interests will appear here as your community grows.
            </p>
          </section>
        )}

        {!loading && !error && posts.length > 0 && viewer && (
          <section className="w-full min-w-0 space-y-3 sm:space-y-5">
            {posts.map((post) => (
              <div
                // The fingerprint changes only when this post's data changed,
                // so a live update refreshes just that card.
                key={`${post.userid}-${post.postId}-${fingerprint(post)}`}
                className="w-full"
              >
                {post.source === "suggested" && (
                  <p className="mb-2 flex items-center gap-1.5 px-4 text-xs font-bold text-[#a17b6c] sm:px-1">
                    <Sparkles size={13} />
                    {post.reason === "friends_liked"
                      ? "Suggested for you · liked by your friends"
                      : "Suggested for you"}
                  </p>
                )}
                <PostCard
                  initialPost={post}
                  viewer={viewer}
                  onRemoved={removePost}
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
};

export default Feed;