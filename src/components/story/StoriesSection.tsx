import { useState } from "react";
import StoryViewer, { type StoryViewerPerson } from "./StoryViewer";

export type StoryPerson = StoryViewerPerson;

type Props = {
  stories: StoryPerson[];
  meId?: string;
  onAddStory: () => void;
  onViewed: (userid: string, storyId: string) => void;
  onDeleted: (userid: string, storyId: string) => void;
  onReplied: (conversationId: string) => void;
};

const RING_LOADING_MS = 1500;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const preload = (src: string) => new Promise<void>((resolve) => {
  const image = new Image();
  image.onload = () => resolve();
  image.onerror = () => resolve();
  image.src = src;
});

function Avatar({ src, name }: { src?: string; name?: string }) {
  return src
    ? <img src={src} alt="" className="h-full w-full rounded-[14px] object-cover" />
    : <div className="grid h-full w-full place-items-center rounded-[14px] bg-[#f2dfd3] font-bold text-[#91452f]">{(name || "J").slice(0, 1).toUpperCase()}</div>;
}

export default function StoriesSection({ stories, meId, onAddStory, onViewed, onDeleted, onReplied }: Props) {
  const [open, setOpen] = useState<{ userid: string; index: number } | null>(null);
  const [loadingId, setLoadingId] = useState("");

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
      <section className="mb-5 rounded-3xl border border-[#eeded3] bg-white/80 p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Stories</h2>
          <span className="text-xs text-[#9c8173]">Friends · 24 hours</span>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          {meId && (
            <button type="button" onClick={onAddStory} className="w-16 shrink-0 text-center">
              <div className="mx-auto mb-1 grid h-14 w-14 place-items-center rounded-2xl border-2 border-dashed border-[#c57b5c] bg-[#fff3eb] text-2xl text-[#a94d32]">+</div>
              <span className="text-xs">Add story</span>
            </button>
          )}
          {stories.map((p) => (
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
          onReplied={({ conversationId }) => onReplied(conversationId)}
        />
      )}
    </>
  );
}