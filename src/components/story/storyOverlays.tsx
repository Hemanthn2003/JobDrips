import { useCallback, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";
import type { StoryOverlay } from "../../services/profileService";

export type { StoryOverlay };

// ---------------------------------------------------------------------------
// Shared by the story editor (StoryComposer) and the story viewer, so that a
// sticker / text sits in the same place everywhere it is shown.
//
// Overlays live on the whole story screen (not only on the picture), so they can
// also be placed on the black area around it:
//   x = fraction of the screen width (0 = left edge, 1 = right edge)
//   y = 0.5 is the vertical centre; one unit is the screen WIDTH, so a sticker keeps
//       the same distance from the (centred) picture on phones of different heights.
// ---------------------------------------------------------------------------

export const MAX_STORY_SECONDS = 60;
export const MAX_CAPTION_LENGTH = 2200;

export type StoryFontId =
  | "sans"
  | "serif"
  | "mono"
  | "script"
  | "display"
  | "marker"
  | "condensed"
  | "elegant";

/** 8 text styles. The ids are validated by the backend, keep both lists in sync. */
export const STORY_FONTS: Array<{ id: StoryFontId; label: string; family: string; weight: number }> = [
  { id: "sans", label: "Classic", family: '"Poppins","Segoe UI",Arial,sans-serif', weight: 600 },
  { id: "serif", label: "Serif", family: '"Playfair Display",Georgia,"Times New Roman",serif', weight: 700 },
  { id: "mono", label: "Typewriter", family: '"Courier Prime","Courier New",monospace', weight: 700 },
  { id: "script", label: "Script", family: '"Pacifico","Brush Script MT","Segoe Script",cursive', weight: 400 },
  { id: "display", label: "Poster", family: '"Bebas Neue",Impact,"Arial Narrow",sans-serif', weight: 400 },
  { id: "marker", label: "Marker", family: '"Permanent Marker","Comic Sans MS","Chalkboard SE",cursive', weight: 400 },
  { id: "condensed", label: "Condensed", family: '"Oswald","Arial Narrow",Arial,sans-serif', weight: 600 },
  { id: "elegant", label: "Fancy", family: '"Lobster","Georgia",serif', weight: 400 },
];

export const STORY_COLORS = [
  "#ffffff",
  "#000000",
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#00c7be",
  "#0a84ff",
  "#5e5ce6",
  "#ff2d92",
  "#a2845e",
];

const FONT_LINK_ID = "jd-story-fonts";
const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Courier+Prime:wght@700&family=Lobster&family=Oswald:wght@600&family=Pacifico&family=Permanent+Marker&family=Playfair+Display:wght@700&family=Poppins:wght@600&display=swap";

/** Loads the Google fonts once (every font also has a system fallback). */
export const ensureStoryFonts = () => {
  if (typeof document === "undefined" || document.getElementById(FONT_LINK_ID)) return;
  const link = document.createElement("link");
  link.id = FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = FONT_HREF;
  document.head.appendChild(link);
};

export const fontOf = (id?: string) => STORY_FONTS.find((font) => font.id === id) ?? STORY_FONTS[0];

/** Font size (px) of an overlay, relative to the width of the story screen. */
export const overlayFontPx = (overlay: Pick<StoryOverlay, "kind" | "scale">, frameWidth: number) =>
  frameWidth * (overlay.kind === "sticker" ? 0.2 : 0.075) * overlay.scale;

/** Black or white, whichever is readable on top of the given hex colour. */
export const contrastOn = (hex: string) => {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "ffffff";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000000" : "#ffffff";
};

/** Typography + chip background of a text overlay (no positioning). */
export const textStyleOf = (
  overlay: Pick<StoryOverlay, "font" | "color" | "background">,
  fontSize: number,
): CSSProperties => {
  const font = fontOf(overlay.font);
  const color = overlay.color || "#ffffff";
  return {
    fontFamily: font.family,
    fontWeight: font.weight,
    fontSize,
    lineHeight: 1.2,
    textAlign: "center",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    color: overlay.background ? contrastOn(color) : color,
    background: overlay.background ? color : "transparent",
    padding: overlay.background ? "0.12em 0.4em" : 0,
    borderRadius: overlay.background ? "0.3em" : 0,
    textShadow: overlay.background ? "none" : "0 1px 6px rgba(0,0,0,.45)",
  };
};

export type StageSize = { w: number; h: number };

/** Pixel position of an overlay's centre inside the story screen. */
export const overlayPoint = (overlay: Pick<StoryOverlay, "x" | "y">, stage: StageSize) => ({
  left: overlay.x * stage.w,
  top: stage.h / 2 + (overlay.y - 0.5) * stage.w,
});

/** Measures an element (re-measured when it resizes). Use `ref` as the element's ref callback. */
export function useElementSize<T extends HTMLElement>() {
  const nodeRef = useRef<T | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState<StageSize>({ w: 0, h: 0 });

  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    nodeRef.current = node;
    if (!node) return;
    const update = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    update();
    observer.current = new ResizeObserver(update);
    observer.current.observe(node);
  }, []);

  return { ref, size, nodeRef };
}

type OverlayViewProps = {
  overlay: StoryOverlay;
  stage: StageSize;
  selected?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

/** One sticker or text, positioned inside the story screen. */
export function OverlayView({ overlay, stage, selected, style, ...rest }: OverlayViewProps) {
  const size = overlayFontPx(overlay, stage.w);
  const isText = overlay.kind === "text";
  const point = overlayPoint(overlay, stage);

  return (
    <div
      {...rest}
      style={{
        position: "absolute",
        left: point.left,
        top: point.top,
        transform: `translate(-50%, -50%) rotate(${overlay.rotation}deg)`,
        width: "max-content",
        maxWidth: stage.w * 0.9,
        userSelect: "none",
        WebkitUserSelect: "none",
        outline: selected ? "1.5px dashed rgba(255,255,255,.95)" : "none",
        outlineOffset: 6,
        ...(isText
          ? textStyleOf(overlay, size)
          : { fontSize: size, lineHeight: 1, textAlign: "center" as const, fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif' }),
        ...style,
      }}
    >
      {overlay.content}
    </div>
  );
}

/** Read-only overlays on top of a story (used by the story viewer). */
export function OverlayLayer({ overlays }: { overlays: StoryOverlay[] }) {
  const { ref, size } = useElementSize<HTMLDivElement>();

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {size.w > 0 &&
        overlays.map((overlay) => <OverlayView key={overlay.id} overlay={overlay} stage={size} />)}
    </div>
  );
}
