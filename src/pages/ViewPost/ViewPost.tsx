import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import PostCard from "../../components/post/PostCard";
import { getPost } from "../../services/postService";
import type { PostData, PostPerson } from "../../services/postService";
import { useSocketEvent } from "../../lib/socket";

/**
 * One post shown exactly like the feed card.
 * Route: /profile/:userid/posts/:postId
 */
const ViewPost = () => {
  const { userid, postId } = useParams<{ userid: string; postId: string }>();
  const navigate = useNavigate();

  const [post, setPost] = useState<PostData | null>(null);
  const [viewer, setViewer] = useState<PostPerson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reloadTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!userid || !postId) return;
    setLoading(true);
    setError("");

    try {
      const result = await getPost(userid, postId);
      setPost(result.post);
      setViewer(result.viewer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this post.");
    } finally {
      setLoading(false);
    }
  }, [userid, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => window.clearTimeout(reloadTimer.current), []);
  useSocketEvent<{ ownerId?: string; postId?: string; actorId?: string }>(
    "post:updated",
    (event) => {
      if (
        event?.ownerId !== userid ||
        event.postId !== postId ||
        event.actorId === viewer?.userid
      ) {
        return;
      }

      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        void load();
      }, 300);
    },
  );

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(userid ? `/profile/${userid}` : "/");
  };

  return (
    <main className="min-h-screen bg-[#faf8f6] pb-10 text-[#332720]">
      <div className="mx-auto w-full max-w-[640px] px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={goBack}
          className="mb-4 flex items-center gap-2 rounded-full px-2 py-1.5 text-sm font-semibold text-[#654536] hover:bg-[#f3eae4]"
        >
          <ArrowLeft size={18} />
          Back
        </button>

        {loading && (
          <div className="animate-pulse overflow-hidden rounded-2xl border border-[#eee4dd] bg-white">
            <div className="h-16 bg-[#f4efeb]" />
            <div className="aspect-[4/3] bg-[#f0e9e4]" />
            <div className="h-24 bg-[#f8f4f1]" />
          </div>
        )}

        {!loading && error && (
          <section className="rounded-2xl border border-[#efdbd4] bg-white px-6 py-12 text-center shadow-sm">
            <h2 className="text-lg font-bold">This post isn't available</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#8b7a70]">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-5 rounded-xl bg-[#654536] px-5 py-2.5 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </section>
        )}

        {!loading && !error && post && viewer && (
          <PostCard initialPost={post} viewer={viewer} onRemoved={goBack} />
        )}
      </div>
    </main>
  );
};

export default ViewPost;
