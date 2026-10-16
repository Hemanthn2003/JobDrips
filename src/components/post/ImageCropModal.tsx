import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { IconRotateLeft, IconRotateRight } from "./PostIcons";

/**
 * Advanced image cropper.
 * - Starts on the FULL, uncropped original frame.
 * - Free crop, or locked ratios (Original, 1:1, 4:5, 3:2, 16:9, 9:16).
 * - Drag the box to move, drag handles to resize, rotate 90°.
 * - Output is cut from the full-resolution original (no downscaling).
 * - onDone(null) means "no change" → the untouched original file is posted.
 */

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
type AspectKey = "free" | "original" | "1:1" | "4:5" | "3:2" | "16:9" | "9:16";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WorkImage {
  url: string;
  img: HTMLImageElement;
  w: number;
  h: number;
}

const ASPECTS: { key: AspectKey; label: string; ratio?: number }[] = [
  { key: "free", label: "Free" },
  { key: "original", label: "Original" },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "4:5", label: "4:5", ratio: 4 / 5 },
  { key: "3:2", label: "3:2", ratio: 3 / 2 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = url;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not export the image."))),
      type,
      0.95
    )
  );

function resizeRect(
  h: Handle,
  r: Rect,
  dx: number,
  dy: number,
  W: number,
  H: number,
  ratio: number | null,
  min: number
): Rect {
  if (h === "move") {
    return { ...r, x: clamp(r.x + dx, 0, W - r.w), y: clamp(r.y + dy, 0, H - r.h) };
  }

  const left = r.x;
  const top = r.y;
  const right = r.x + r.w;
  const bottom = r.y + r.h;

  // Locked ratio: corners only, anchored on the opposite corner.
  if (ratio && h.length === 2) {
    const west = h.includes("w");
    const north = h.includes("n");
    const ax = west ? right : left;
    const ay = north ? bottom : top;
    const px = clamp((west ? left : right) + dx, 0, W);
    const py = clamp((north ? top : bottom) + dy, 0, H);
    const dirX = west ? -1 : 1;
    const dirY = north ? -1 : 1;

    let w = Math.max((px - ax) * dirX, (py - ay) * dirY * ratio);
    const maxW = Math.min(dirX > 0 ? W - ax : ax, (dirY > 0 ? H - ay : ay) * ratio);
    w = clamp(w, Math.min(min, maxW), maxW);
    const hh = w / ratio;
    return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - hh, w, h: hh };
  }

  let nl = left;
  let nt = top;
  let nr = right;
  let nb = bottom;
  if (h.includes("w")) nl = clamp(left + dx, 0, right - min);
  if (h.includes("e")) nr = clamp(right + dx, left + min, W);
  if (h.includes("n")) nt = clamp(top + dy, 0, bottom - min);
  if (h.includes("s")) nb = clamp(bottom + dy, top + min, H);
  return { x: nl, y: nt, w: nr - nl, h: nb - nt };
}

const fullRect = (W: number, H: number): Rect => ({ x: 0, y: 0, w: W, h: H });

const fitRatio = (W: number, H: number, ratio: number): Rect => {
  let w = W;
  let h = W / ratio;
  if (h > H) {
    h = H;
    w = H * ratio;
  }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
};

const HANDLE_POS: Record<Exclude<Handle, "move">, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

interface Props {
  /** Object URL of the ORIGINAL file. */
  src: string;
  mimeType: string;
  onCancel: () => void;
  /** null = nothing changed, keep the original file. */
  onDone: (result: { blob: Blob; width: number; height: number } | null) => void;
}

const ImageCropModal = ({ src, mimeType, onCancel, onDone }: Props) => {
  const [work, setWork] = useState<WorkImage | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [aspect, setAspect] = useState<AspectKey>("free");
  const [rotated, setRotated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; px: number; py: number; rect: Rect } | null>(null);
  const workUrlRef = useRef<string | null>(null);

  const outType = mimeType === "image/png" || mimeType === "image/webp" ? mimeType : "image/jpeg";

  /* ---- load the original ---- */
  useEffect(() => {
    let alive = true;
    loadImage(src)
      .then((img) => {
        if (!alive) return;
        setWork({ url: src, img, w: img.naturalWidth, h: img.naturalHeight });
        setRect(fullRect(img.naturalWidth, img.naturalHeight));
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [src]);

  /* ---- free any rotated copy we made ---- */
  useEffect(
    () => () => {
      if (workUrlRef.current) URL.revokeObjectURL(workUrlRef.current);
    },
    []
  );

  /* ---- measure the stage ---- */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- lock page scroll behind the modal ---- */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const k = useMemo(() => {
    if (!work || !stage.w || !stage.h) return 0;
    return Math.min(stage.w / work.w, stage.h / work.h);
  }, [work, stage]);

  const ratio = useMemo<number | null>(() => {
    if (!work || aspect === "free") return null;
    if (aspect === "original") return work.w / work.h;
    return ASPECTS.find((a) => a.key === aspect)?.ratio ?? null;
  }, [work, aspect]);

  const minSize = k ? 32 / k : 32;

  const chooseAspect = (key: AspectKey) => {
    if (!work) return;
    setAspect(key);
    if (key === "free") return;
    const r = key === "original" ? work.w / work.h : (ASPECTS.find((a) => a.key === key)?.ratio ?? 1);
    setRect(fitRatio(work.w, work.h, r));
  };

  /* ---- pointer handling ---- */
  const bind = (handle: Handle) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { handle, px: e.clientX, py: e.clientY, rect: { ...rect } };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || !work || !k) return;
      const dx = (e.clientX - d.px) / k;
      const dy = (e.clientY - d.py) / k;
      setRect(resizeRect(d.handle, d.rect, dx, dy, work.w, work.h, ratio, minSize));
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  });

  /* ---- rotate 90° ---- */
  const rotate = useCallback(
    async (dir: 1 | -1) => {
      if (!work) return;
      setBusy(true);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = work.h;
        canvas.height = work.w;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is not available.");
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((dir * Math.PI) / 2);
        ctx.drawImage(work.img, -work.w / 2, -work.h / 2);
        const blob = await canvasToBlob(canvas, outType);
        const url = URL.createObjectURL(blob);
        const img = await loadImage(url);
        if (workUrlRef.current) URL.revokeObjectURL(workUrlRef.current);
        workUrlRef.current = url;
        setWork({ url, img, w: img.naturalWidth, h: img.naturalHeight });
        setRect(fullRect(img.naturalWidth, img.naturalHeight));
        setAspect("free");
        setRotated(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Rotate failed.");
      } finally {
        setBusy(false);
      }
    },
    [work, outType]
  );

  const reset = async () => {
    try {
      const img = await loadImage(src);
      if (workUrlRef.current) {
        URL.revokeObjectURL(workUrlRef.current);
        workUrlRef.current = null;
      }
      setWork({ url: src, img, w: img.naturalWidth, h: img.naturalHeight });
      setRect(fullRect(img.naturalWidth, img.naturalHeight));
      setAspect("free");
      setRotated(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    }
  };

  const unchanged =
    !!work &&
    !rotated &&
    rect.x < 0.5 &&
    rect.y < 0.5 &&
    Math.abs(rect.w - work.w) < 0.5 &&
    Math.abs(rect.h - work.h) < 0.5;

  const finish = async () => {
    if (!work) return;
    if (unchanged) return onDone(null);
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.w));
      canvas.height = Math.max(1, Math.round(rect.h));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available.");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(work.img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, outType);
      onDone({ blob, width: canvas.width, height: canvas.height });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not crop the image.");
      setBusy(false);
    }
  };

  const showRect = work && k > 0;
  const dispW = work ? work.w * k : 0;
  const dispH = work ? work.h * k : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#120d0b] text-white">
      {/* top bar */}
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[15px] font-semibold text-white/80">
          Cancel
        </button>
        <h2 className="text-[16px] font-extrabold">Edit photo</h2>
        <button
          type="button"
          onClick={finish}
          disabled={!work || busy}
          className="rounded-full bg-gradient-to-b from-[#C8704F] to-[#A5472F] px-5 py-1.5 text-[15px] font-bold disabled:opacity-50"
        >
          {unchanged ? "Keep original" : "Done"}
        </button>
      </div>

      {/* stage */}
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        {error && <p className="text-sm text-red-300">{error}</p>}
        {showRect && work && (
          <div
            className="relative select-none overflow-hidden"
            style={{ width: dispW, height: dispH, touchAction: "none" }}
          >
            <img
              src={work.url}
              alt=""
              draggable={false}
              className="pointer-events-none block h-full w-full select-none"
            />

            {/* crop box (the giant shadow darkens everything outside it) */}
            <div
              {...bind("move")}
              className="absolute cursor-move border border-white/90"
              style={{
                left: rect.x * k,
                top: rect.y * k,
                width: rect.w * k,
                height: rect.h * k,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                touchAction: "none",
              }}
            >
              {/* rule-of-thirds grid */}
              <div className="pointer-events-none absolute inset-0 opacity-60">
                <div className="absolute inset-x-0 top-1/3 border-t border-white/50" />
                <div className="absolute inset-x-0 top-2/3 border-t border-white/50" />
                <div className="absolute inset-y-0 left-1/3 border-l border-white/50" />
                <div className="absolute inset-y-0 left-2/3 border-l border-white/50" />
              </div>

              {(Object.keys(HANDLE_POS) as Exclude<Handle, "move">[])
                .filter((h) => !ratio || h.length === 2)
                .map((h) => (
                  <span
                    key={h}
                    {...bind(h)}
                    className={`absolute z-10 flex h-8 w-8 items-center justify-center ${HANDLE_POS[h]}`}
                    style={{ touchAction: "none" }}
                  >
                    <span
                      className={`block bg-white shadow ${
                        h.length === 2 ? "h-3.5 w-3.5 rounded-full" : h === "n" || h === "s" ? "h-1.5 w-7 rounded-full" : "h-7 w-1.5 rounded-full"
                      }`}
                    />
                  </span>
                ))}
            </div>
          </div>
        )}
        {!work && !error && <p className="text-sm text-white/60">Loading…</p>}
      </div>

      {/* controls */}
      <div className="space-y-3 px-4 pb-6 pt-3">
        <div className="flex items-center justify-between text-[12px] font-semibold text-white/60">
          <span>
            {work ? `${Math.round(rect.w)} × ${Math.round(rect.h)} px` : ""}
            {work && !unchanged ? "  ·  cropped" : "  ·  original size"}
          </span>
          <button type="button" onClick={reset} className="rounded px-2 py-1 text-white/80 underline-offset-2 hover:underline">
            Reset
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => chooseAspect(a.key)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-bold ${
                  aspect === a.key
                    ? "border-[#E39A7D] bg-[#E39A7D] text-[#2a140c]"
                    : "border-white/25 text-white/85"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Rotate left"
            onClick={() => rotate(-1)}
            disabled={busy || !work}
            className="shrink-0 rounded-full border border-white/25 p-2 disabled:opacity-40"
          >
            <IconRotateLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Rotate right"
            onClick={() => rotate(1)}
            disabled={busy || !work}
            className="shrink-0 rounded-full border border-white/25 p-2 disabled:opacity-40"
          >
            <IconRotateRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageCropModal;
