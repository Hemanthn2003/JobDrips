import { Component, lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const StickerPicker = lazy(() => import("./StickerPicker"));

// Small built-in set, used only when the sticker package could not be loaded.
const BASIC_STICKERS =
  "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😎 🤩 🥳 😜 🤪 🤗 🤔 😴 😭 😡 🥺 😱 🤯 🙏 👍 👎 👏 🙌 💪 👀 🔥 ✨ 🎉 🎊 🎁 🎂 ❤️ 🧡 💛 💚 💙 💜 🖤 💯 💥 ⭐ 🌟 🌈 ☀️ 🌙 ⚡ ❄️ 🌸 🌹 🍀 🍕 🍔 🍟 🍩 🍿 ☕ 🍺 🥂 ⚽ 🏀 🎮 🎧 🎵 🎬 📸 ✈️ 🚗 🏖️ 🏠 💼 💻 📱 💡 📌 ✅ ❌ ⚠️ 💬 🎯 🚀 👑 💎".split(" ");

class StickerBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Sticker list failed to load:", error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** The sticker list shown in the story editor. Falls back to a basic grid if the package is missing. */
export default function StickerList({ onPick }: { onPick: (emoji: string) => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);

  // The picker needs a real pixel height (a "100%" height can collapse to 0 inside a flex box).
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fallback = (
    <div className="h-full overflow-y-auto">
      <p className="px-2 pb-2 text-[11px] text-white/60">Showing basic stickers. Run <code>npm i emoji-picker-react</code> for the full list.</p>
      <div className="grid grid-cols-8 gap-1">
        {BASIC_STICKERS.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onPick(emoji)} className="rounded-lg p-1.5 text-2xl hover:bg-white/10">{emoji}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div ref={boxRef} className="h-full w-full">
      <StickerBoundary fallback={fallback}>
        <Suspense fallback={<div className="grid h-full place-items-center"><span className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/30 border-t-white" /></div>}>
          {height > 0 && <StickerPicker onPick={onPick} height={height} />}
        </Suspense>
      </StickerBoundary>
    </div>
  );
}
