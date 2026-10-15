import { useEffect, useMemo, useRef, useState } from "react";
import StoryViewer, { type StoryViewerPerson } from "./StoryViewer";

export type StoryPerson = StoryViewerPerson;

type Props = {
  stories: StoryPerson[];
  meId?: string;
  onAddStory: () => void;
  onViewed: (userid: string, storyId: string) => void;
  onDeleted: (userid: string, storyId: string) => void;
  onReplied?: (conversationId: string) => void;
};

const RING_LOADING_MS = 1500;
const DRAG_THRESHOLD_PX = 5;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const preload = (src: string) => new Promise<void>((resolve) => {
  const image = new Image();
  image.onload = () => resolve();
  image.onerror = () => resolve();
  image.src = src;
});

/** Time of the person's most recently uploaded story (0 when unknown). */
const latestStoryTime = (person: StoryPerson) =>
  person.stories.reduce((latest, story) => Math.max(latest, new Date(story.createdAt).getTime() || 0), 0);

function Avatar({ src, name }: { src?: string; name?: string }) {
  return src
    ? <img src={src} alt="" draggable={false} className="h-full w-full rounded-[14px] object-cover" />
    : <div className="grid h-full w-full place-items-center rounded-[14px] bg-[#f2dfd3] font-bold text-[#91452f]">{(name || "J").slice(0, 1).toUpperCase()}</div>;
}

// Desktop: a thin visible horizontal scrollbar. Phones / tablets (touch): no scrollbar,
// finger-drag scrolling with momentum.
const SCROLLER_CSS = `
.stories-scroll{overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scrollbar-width:thin;scrollbar-color:#d5bcae transparent}
.stories-scroll::-webkit-scrollbar{height:6px}
.stories-scroll::-webkit-scrollbar-track{background:transparent}
.stories-scroll::-webkit-scrollbar-thumb{background:#d5bcae;border-radius:999px}
@media (pointer:coarse){.stories-scroll{scrollbar-width:none}.stories-scroll::-webkit-scrollbar{display:none}}
`;

export default function StoriesSection({ stories, meId, onAddStory, onViewed, onDeleted, onReplied }: Props) {
  const [open, setOpen] = useState<{ userid: string; index: number } | null>(null);
  const [loadingId, setLoadingId] = useState("");
  const [dragging, setDragging] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, startX: 0, startLeft: 0, moved: false });

  // Most recently uploaded story first, oldest last (a new upload jumps to the front).
  const ordered = useMemo(
    () => [...stories].sort((a, b) => latestStoryTime(b) - latestStoryTime(a) || a.username.localeCompare(b.username)),
    [stories],
  );

  // Mouse "press and drag" scrolling. Touch screens already scroll natively with the finger.
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = drag.current;
      const el = scrollerRef.current;
      if (!state.active || !el) return;
      const dx = event.clientX - state.startX;
      if (!state.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) { state.moved = true; setDragging(true); }
      if (state.moved) { el.scrollLeft = state.startLeft - dx; event.preventDefault(); }
    };
    const onUp = () => {
      if (!drag.current.active) return;
      drag.current.active = false;
      setDragging(false);
      // Keep "moved" until the click that follows the mouse-up has been swallowed.
      window.setTimeout(() => { drag.current.moved = false; }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    if (event.button !== 0 || !el) return;
    drag.current = { active: true, startX: event.clientX, startLeft: el.scrollLeft, moved: false };
  };

  // A drag must not open a story when the mouse is released over one.
  const onClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); }
  };

  const openPerson = async (person: StoryPerson) => {
    if (loadingId || person.stories.length === 0) return;
    const firstUnseen = person.stories.findIndex((s) => !s.seen);
    const start = firstUnseen === -1 ? 0 : firstUnseen;
    const startedAt = Date.now();
    setLoadingId(person.userid);
    await preload(person.stories[start].imageUrl);
    await wait(Math.max(0, RING_LOADING_MS - (Date.now() - startedAt))); // 1.5 s ring spinner
    setLoadingId("");
    setOpen({ userid: person.userid, index: start });
  };

  const current = open ? stories.find((p) => p.userid === open.userid) : undefined;

  return (
    <>
      <style>{SCROLLER_CSS}</style>

      {/* Transparent: no border, background or shadow. Margin on top/left/right (bottom unchanged). */}
      <section className="mb-4 mt-4 mx-4 min-w-0 max-w-full bg-transparent sm:mt-5 sm:mx-5 lg:mt-6 lg:mx-6">
        <div
          ref={scrollerRef}
          onMouseDown={onMouseDown}
          onClickCapture={onClickCapture}
          onDragStart={(e) => e.preventDefault()}
          className="stories-scroll flex w-full min-w-0 max-w-full select-none gap-4 pb-2"
          style={{ cursor: dragging ? "grabbing" : "grab" }}
        >
          {meId && (
            <button type="button" onClick={onAddStory} className="w-16 shrink-0 text-center">
              <div className="mx-auto mb-1 grid h-14 w-14 place-items-center rounded-2xl border-2 border-dashed border-[#c57b5c] bg-[#fff3eb] text-2xl text-[#a94d32]">+</div>
              <span className="text-xs">Add story</span>
            </button>
          )}
          {ordered.map((p) => (
            <button key={p.userid} type="button" onClick={() => void openPerson(p)} className="w-16 shrink-0 text-center">
              <div className={`relative mx-auto mb-1 h-14 w-14 rounded-2xl p-[3px] ${p.stories.some((s) => !s.seen) ? "bg-gradient-to-br from-[#ffb36e] via-[#d74e35] to-[#8d3f2b] shadow-[0_0_0_2px_rgba(215,78,53,.18)]" : "bg-[#d9c8bd]"}`}>
                <Avatar src={p.profileimage} name={p.username} />
                {loadingId === p.userid && (
                  <span className="absolute inset-0 grid place-items-center rounded-2xl bg-black/35">
                    <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
                  </span>
                )}
              </div>
              <span className="block truncate text-xs">{p.userid === meId ? "You" : p.username}</span>
            </button>
          ))}
          {stories.length === 0 && <p className="py-3 text-sm text-[#9c8173]">Friends’ active stories will appear here.</p>}
        </div>
      </section>

      {open && current && (
        <StoryViewer
          key={open.userid}
          person={current}
          startIndex={open.index}
          isOwner={current.userid === meId}
          onClose={() => setOpen(null)}
          onViewed={(storyId) => onViewed(current.userid, storyId)}
          onDeleted={(storyId) => onDeleted(current.userid, storyId)}
          onReplied={onReplied ? ({ conversationId }) => onReplied(conversationId) : undefined}
        />
      )}
    </>
  );
}
