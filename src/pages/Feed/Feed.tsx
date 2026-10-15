import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, RefreshCw } from "lucide-react";
import PostCard from "../../components/post/PostCard";
import { getFeed } from "../../services/postService";
import type { PostData, PostPerson } from "../../services/postService";
import { useSocketEvent } from "../../lib/socket";

/** Small stable fingerprint, so only posts that really changed are re-rendered fresh. */
const fingerprint = (post: PostData): number => {
  const text = JSON.stringify(post);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
};

const Feed = () => {
  const [posts, setPosts] = useState<PostData[]>([]);
  const [viewer, setViewer] = useState<PostPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloadTimer = useRef<number | undefined>(undefined);
  const viewerRef = useRef<PostPerson | null>(null);
  viewerRef.current = viewer;

  // silent = refresh in the background (no skeleton, errors ignored).
  const loadFeed = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const result = await getFeed();
      setPosts(result.posts);
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
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);

  // Live updates: another person liked, commented, saved, shared, edited,
  // archived or deleted a post (or published a new one).
  useSocketEvent<{ actorId?: string }>("post:updated", (payload) => {
    const me = (viewerRef.current as unknown as { userid?: string } | null)?.userid;
    // My own actions are already shown instantly on screen.
    if (me && payload?.actorId === me) return;

    window.clearTimeout(reloadTimer.current);
    reloadTimer.current = window.setTimeout(() => {
      void loadFeed(true);
    }, 400);
  });

  const removePost = useCallback((postId: string) => {
    setPosts((previous) => previous.filter((post) => post.postId !== postId));
  }, []);

  return (
    <main className="min-h-screen bg-[#faf8f6] pb-8 text-[#332720]">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5 sm:px-6 lg:px-8">
        {loading && (
          <div className="mx-auto max-w-[900px] space-y-5 lg:pr-[290px]">
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
          <section className="mx-auto max-w-[900px] rounded-2xl border border-[#efdbd4] bg-white px-6 py-12 text-center shadow-sm">
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
          <section className="mx-auto max-w-[900px] rounded-2xl border border-[#eee4dd] bg-white px-6 py-14 text-center shadow-sm">
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

        {!loading && !error && posts.length > 0 && viewer && (
          <div className="mx-auto grid max-w-[900px] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_270px] lg:items-start">
            <section className="min-w-0 space-y-5">
              {posts.map((post) => (
                <PostCard
                  // The fingerprint changes only when this post's data changed,
                  // so a live update refreshes just that card.
                  key={`${post.userid}-${post.postId}-${fingerprint(post)}`}
                  initialPost={post}
                  viewer={viewer}
                  onRemoved={removePost}
                />
              ))}
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