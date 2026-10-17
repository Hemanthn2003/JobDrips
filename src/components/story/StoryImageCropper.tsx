import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Check, RotateCw, X } from "lucide-react";

// Crop step of the story editor. The crop always lives inside the picture's own
// frame: it starts as the full original image and can only be made smaller.

export type CropRect = { x: number; y: number; w: number; h: number }; // 0..1 of the (rotated) image
export type CropState = { rotation: 0 | 90 | 180 | 270; crop: CropRect; preset: string };
export type CropResult = { blob: Blob; width: number; height: number; state: CropState };

const MAX_UPLOAD_BYTES = Math.floor(4.8 * 1024 * 1024); // the image API accepts 5 MB
const UPLOADABLE = ["image/jpeg", "image/png", "image/webp"];
const MIN_SIZE = 0.08;
const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

type HandleId = "move" | "tl" | "tr" | "bl" | "br" | "t" | "b" | "l" | "r";
type Preset = { id: string; label: string; ratio: number | null | "original" };

const PRESETS: Preset[] = [
  { id: "original", label: "Original", ratio: "original" },
  { id: "free", label: "Free", ratio: null },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Moves / resizes a crop box. dx / dy are fractions of the image. ratio = width px / height px. */
function adjustCrop(
  start: CropRect,
  handle: HandleId,
  dx: number,
  dy: number,
  ratio: number | null,
  imgW: number,
  imgH: number,
): CropRect {
  if (handle === "move") {
    return { ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) };
  }

  const left = handle.includes("l");
  const right = handle.includes("r");
  const top = handle.includes("t");
  const bottom = handle.includes("b");
  const isCorner = handle.length === 2;

  if (ratio && isCorner) {
    // Opposite corner stays where it is.
    const anchorX = left ? start.x + start.w : start.x;
    const anchorY = top ? start.y + start.h : start.y;
    const cornerX = (left ? start.x : start.x + start.w) + dx;
    const cornerY = (top ? start.y : start.y + start.h) + dy;

    let wPx = Math.abs(anchorX - cornerX) * imgW;
    let hPx = Math.abs(anchorY - cornerY) * imgH;
    if (wPx / Math.max(hPx, 1e-6) > ratio) hPx = wPx / ratio;
    else wPx = hPx * ratio;

    let w = wPx / imgW;
    let h = hPx / imgH;
    const roomW = left ? anchorX : 1 - anchorX;
    const roomH = top ? anchorY : 1 - anchorY;
    const shrink = Math.min(1, roomW / w, roomH / h);
    w *= shrink;
    h *= shrink;
    if (w < MIN_SIZE) { const grow = MIN_SIZE / w; w *= grow; h *= grow; }
    if (h < MIN_SIZE) { const grow = MIN_SIZE / h; w *= grow; h *= grow; }
    w = Math.min(w, roomW);
    h = Math.min(h, roomH);

    return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w, h };
  }

  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.w;
  let y2 = start.y + start.h;
  if (left) x1 = clamp(x1 + dx, 0, x2 - MIN_SIZE);
  if (right) x2 = clamp(x2 + dx, x1 + MIN_SIZE, 1);
  if (top) y1 = clamp(y1 + dy, 0, y2 - MIN_SIZE);
  if (bottom) y2 = clamp(y2 + dy, y1 + MIN_SIZE, 1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Largest centred box with the given pixel ratio inside the image. */
function fitRatio(ratio: number, imgW: number, imgH: number): CropRect {
  let wPx = imgW;
  let hPx = wPx / ratio;
  if (hPx > imgH) { hPx = imgH; wPx = hPx * ratio; }
  const w = wPx / imgW;
  const h = hPx / imgH;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This image can't be opened."));
    image.src = url;
  });

const readImageFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("This image can't be opened."));
    reader.onerror = () => reject(new Error("This image can't be opened."));
    reader.readAsDataURL(file);
  });

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Draws the image rotated by a multiple of 90° onto a new canvas. */
function rotateToCanvas(image: HTMLImageElement, rotation: number): HTMLCanvasElement {
  const turned = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = turned ? image.naturalHeight : image.naturalWidth;
  canvas.height = turned ? image.naturalWidth : image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image editing is not supported in this browser.");
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

type Props = {
  file: File;
  initial?: CropState | null;
  onCancel: () => void;
  onDone: (result: CropResult) => void;
};

export default function StoryImageCropper({ file, initial, onCancel, onDone }: Props) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState("");
  const [rotation, setRotation] = useState<CropState["rotation"]>(initial?.rotation ?? 0);
  const [crop, setCrop] = useState<CropRect>(initial?.crop ?? FULL);
  const [preset, setPreset] = useState(initial?.preset ?? "original");
  const [workUrl, setWorkUrl] = useState("");
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const workRef = useRef<HTMLImageElement | HTMLCanvasElement | null>(null);
  const sourceUrl = useRef("");
  const rotatedUrl = useRef("");
  const drag = useRef<{ id: HandleId; x: number; y: number; rect: CropRect } | null>(null);

  // Load the picked file.
  useEffect(() => {
    let alive = true;
    setImage(null);
    setLoadError("");
    void readImageFile(file)
      .then((url) => {
        if (!alive) return;
        sourceUrl.current = url;
        return loadImage(url);
      })
      .then((loaded) => { if (alive && loaded) setImage(loaded); })
      .catch((e: unknown) => { if (alive) setLoadError(e instanceof Error ? e.message : "This image can't be opened."); });
    return () => {
      alive = false;
      if (rotatedUrl.current) URL.revokeObjectURL(rotatedUrl.current);
    };
  }, [file]);

  // Working picture = original, turned by the chosen rotation.
  useEffect(() => {
    if (!image) return;
    let alive = true;
    if (rotatedUrl.current) { URL.revokeObjectURL(rotatedUrl.current); rotatedUrl.current = ""; }

    if (rotation === 0) {
      workRef.current = image;
      setWorkUrl(sourceUrl.current);
      return;
    }
    const canvas = rotateToCanvas(image, rotation);
    workRef.current = canvas;
    void toBlob(canvas, "image/jpeg", 0.92).then((blob) => {
      if (!alive || !blob) return;
      rotatedUrl.current = URL.createObjectURL(blob);
      setWorkUrl(rotatedUrl.current);
    });
    return () => { alive = false; };
  }, [image, rotation]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [image]);

  const turned = rotation === 90 || rotation === 270;
  const workW = image ? (turned ? image.naturalHeight : image.naturalWidth) : 0;
  const workH = image ? (turned ? image.naturalWidth : image.naturalHeight) : 0;

  const padding = 32;
  const scale = workW && stage.w ? Math.min((stage.w - padding) / workW, (stage.h - padding) / workH) : 0;
  const dispW = Math.max(0, workW * scale);
  const dispH = Math.max(0, workH * scale);

  const activeRatio = (): number | null => {
    const found = PRESETS.find((p) => p.id === preset);
    if (!found || found.ratio === null) return null;
    return found.ratio === "original" ? workW / workH : found.ratio;
  };

  const choosePreset = (next: Preset) => {
    setPreset(next.id);
    if (next.ratio === null) return;
    if (next.ratio === "original") setCrop(FULL);
    else setCrop(fitRatio(next.ratio, workW, workH));
  };

  const rotate = () => {
    setRotation((old) => ((old + 90) % 360) as CropState["rotation"]);
    setCrop(FULL);
    setPreset("original");
  };

  const begin = (id: HandleId) => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, x: event.clientX, y: event.clientY, rect: crop };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !dispW || !dispH) return;
    const dx = (event.clientX - d.x) / dispW;
    const dy = (event.clientY - d.y) / dispH;
    setCrop(adjustCrop(d.rect, d.id, dx, dy, activeRatio(), workW, workH));
  };
  const end = () => { drag.current = null; };

  const finish = async () => {
    const work = workRef.current;
    if (!image || !work || busy) return;
    setBusy(true);
    try {
      const sx = Math.round(crop.x * workW);
      const sy = Math.round(crop.y * workH);
      const sw = Math.max(1, Math.round(crop.w * workW));
      const sh = Math.max(1, Math.round(crop.h * workH));
      const state: CropState = { rotation, crop, preset };
      const untouched = rotation === 0 && crop.w > 0.999 && crop.h > 0.999;

      // Nothing changed and the file is already uploadable: keep the original bytes.
      if (untouched && UPLOADABLE.includes(file.type) && file.size <= MAX_UPLOAD_BYTES) {
        onDone({ blob: file, width: workW, height: workH, state });
        return;
      }

      // Otherwise export the chosen area at its original resolution (only shrunk if needed for the size limit).
      let factor = Math.min(1, 4096 / Math.max(sw, sh));
      let blob: Blob | null = null;
      for (let attempt = 0; attempt < 8 && !blob; attempt += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sw * factor));
        canvas.height = Math.max(1, Math.round(sh * factor));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Image editing is not supported in this browser.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(work, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

        for (const quality of [0.92, 0.85, 0.75]) {
          const candidate = await toBlob(canvas, "image/jpeg", quality);
          if (candidate && candidate.size <= MAX_UPLOAD_BYTES) { blob = candidate; break; }
        }
        factor *= 0.8;
      }
      if (!blob) throw new Error("This image is too large. Choose a smaller one.");
      onDone({ blob, width: sw, height: sh, state });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to crop this image.");
    } finally {
      setBusy(false);
    }
  };

  const ratioLocked = activeRatio() !== null;
  const handles: Array<{ id: HandleId; style: CSSProperties; cursor: string }> = [
    { id: "tl", style: { left: 0, top: 0 }, cursor: "nwse-resize" },
    { id: "tr", style: { left: "100%", top: 0 }, cursor: "nesw-resize" },
    { id: "bl", style: { left: 0, top: "100%" }, cursor: "nesw-resize" },
    { id: "br", style: { left: "100%", top: "100%" }, cursor: "nwse-resize" },
    ...(ratioLocked
      ? []
      : [
          { id: "t" as HandleId, style: { left: "50%", top: 0 }, cursor: "ns-resize" },
          { id: "b" as HandleId, style: { left: "50%", top: "100%" }, cursor: "ns-resize" },
          { id: "l" as HandleId, style: { left: 0, top: "50%" }, cursor: "ew-resize" },
          { id: "r" as HandleId, style: { left: "100%", top: "50%" }, cursor: "ew-resize" },
        ]),
  ];

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0f0a08] text-white">
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Cancel" onClick={onCancel} className="rounded-full bg-white/10 p-2"><X size={20} /></button>
        <span className="text-sm font-bold">Crop</span>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={busy || !image}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-4 py-2 text-sm font-extrabold disabled:opacity-60"
        >
          {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" /> : <Check size={16} />} Next
        </button>
      </div>

      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        {loadError && <p role="alert" className="mx-6 rounded-xl bg-red-600/90 px-3 py-2 text-center text-xs font-semibold">{loadError}</p>}
        {!image && !loadError && <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />}

        {image && workUrl && dispW > 0 && (
          <div style={{ width: dispW, height: dispH }} className="relative touch-none select-none">
            <img src={workUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full" />

            {/* dimmed area outside the crop (clipped to the picture) */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                className="absolute"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,.6)",
                }}
              />
            </div>

            {/* the crop box itself is not clipped, so its edge handles stay fully grabbable */}
            <div
              onPointerDown={begin("move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute cursor-move border border-white"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
              }}
            >
              {/* rule-of-thirds guides */}
              <span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/35" />
              <span className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/35" />
              <span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/35" />
              <span className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/35" />

              {handles.map((handle) => (
                <span
                  key={handle.id}
                  onPointerDown={begin(handle.id)}
                  onPointerMove={move}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center"
                  style={{ ...handle.style, cursor: handle.cursor, touchAction: "none" }}
                >
                  <span className={`block rounded-sm bg-white shadow ${handle.id.length === 2 ? "h-3.5 w-3.5" : handle.id === "t" || handle.id === "b" ? "h-1.5 w-6" : "h-6 w-1.5"}`} />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => choosePreset(item)}
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold ${preset === item.id ? "bg-white text-black" : "bg-white/10 text-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Rotate" title="Rotate 90°" onClick={rotate} className="shrink-0 rounded-full bg-white/10 p-2.5"><RotateCw size={18} /></button>
      </div>
    </div>
  );
}
