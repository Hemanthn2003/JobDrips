import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Crop,
  Minus,
  Pencil,
  Plus,
  RotateCw,
  Scissors,
  Send,
  Smile,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { profileService } from "../../services/profileService";
import type { Story, StoryOverlay, StoryPayload } from "../../services/profileService";
import StoryImageCropper from "./StoryImageCropper";
import type { CropState } from "./StoryImageCropper";
import StoryVideoTrimmer from "./StoryVideoTrimmer";
import type { TrimRange } from "./StoryVideoTrimmer";
import StickerList from "./StickerList";
import {
  MAX_CAPTION_LENGTH,
  MAX_STORY_SECONDS,
  OverlayView,
  STORY_COLORS,
  STORY_FONTS,
  ensureStoryFonts,
  overlayFontPx,
  textStyleOf,
  useElementSize,
} from "./storyOverlays";

// The caption box can scroll, but never shows a scrollbar.
const HIDE_SCROLLBAR_CSS = `.jd-noscroll{scrollbar-width:none;-ms-overflow-style:none}.jd-noscroll::-webkit-scrollbar{display:none}`;

type Props = {
  /** The image or video picked from the device. */
  file: File;
  onClose: () => void;
  /** Called with the saved story once it is published. */
  onPublished: (story: Story) => void;
};

type Step = "loading" | "edit" | "compose";
type TextDraft = {
  id: string | null;
  text: string;
  font: string;
  color: string;
  background: boolean;
  scale: number;
  x: number;
  y: number;
  rotation: number;
};
type Gesture = {
  id: string;
  mode: "drag" | "pinch";
  sx: number;
  sy: number;
  ox: number;
  oy: number;
  moved: boolean;
  wasSelected: boolean;
  d0: number;
  a0: number;
  s0: number;
  r0: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const normalizeDegrees = (value: number) => {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 10) / 10;
};
const extensionOf = (type: string) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");
const dropShadow = "drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]";

export default function StoryComposer({ file, onClose, onPublished }: Props) {
  const isVideo = file.type.startsWith("video/");

  const [step, setStep] = useState<Step>(isVideo ? "loading" : "edit");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // image
  const [cropState, setCropState] = useState<CropState | null>(null);
  const [cropped, setCropped] = useState<{ blob: Blob; url: string; aspect: number } | null>(null);
  const croppedUrlRef = useRef("");
  // video
  const [videoMeta, setVideoMeta] = useState<{ duration: number; aspect: number } | null>(null);
  const [trim, setTrim] = useState<TrimRange | null>(null);
  const [trimConfirmed, setTrimConfirmed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trimRef = useRef<TrimRange | null>(null);
  trimRef.current = trim;

  // compose
  const [overlays, setOverlays] = useState<StoryOverlay[]>([]);
  const overlaysRef = useRef<StoryOverlay[]>([]);
  overlaysRef.current = overlays;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [editor, setEditor] = useState<TextDraft | null>(null);
  const [caption, setCaption] = useState("");
  const { ref: stageRef, size: stage, nodeRef: stageNode } = useElementSize<HTMLDivElement>();
  const [dragging, setDragging] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const overTrashRef = useRef(false);

  const trashRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  useEffect(() => { ensureStoryFonts(); }, []);

  // Object URL of the picked video (images get theirs from the cropper).
  useEffect(() => {
    if (!isVideo) return;
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isVideo]);

  useEffect(() => () => { if (croppedUrlRef.current) URL.revokeObjectURL(croppedUrlRef.current); }, []);

  // Read the video's length and shape. Longer than 60 s -> the trim step comes first.
  useEffect(() => {
    if (!isVideo || !sourceUrl) return;
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => {
      const duration = probe.duration;
      if (!Number.isFinite(duration) || duration <= 0 || !probe.videoWidth) {
        setError("This video can't be read. Try an MP4 file.");
        return;
      }
      setVideoMeta({ duration, aspect: probe.videoWidth / probe.videoHeight });
      setTrim({ start: 0, end: Math.min(duration, MAX_STORY_SECONDS) });
      setStep(duration > MAX_STORY_SECONDS ? "edit" : "compose");
    };
    probe.onerror = () => setError("This video can't be opened. Try an MP4 file.");
    probe.src = sourceUrl;
    return () => { probe.removeAttribute("src"); probe.load(); };
  }, [isVideo, sourceUrl]);

  // Preview of the chosen part of the video, looping inside the trim range.
  useEffect(() => {
    const video = videoRef.current;
    if (step !== "compose" || !video || !trim) return;
    video.currentTime = trim.start;
    void video.play().catch(() => undefined);
  }, [step, trim]);

  // Caption box grows with its text (up to ~4 lines).
  useEffect(() => {
    const el = captionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 104)}px`;
  }, [caption, step]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editor?.text, editor?.font, editor?.scale]);

  // ---------------- editing steps ----------------

  const afterCrop = (result: { blob: Blob; width: number; height: number; state: CropState }) => {
    if (croppedUrlRef.current) URL.revokeObjectURL(croppedUrlRef.current);
    const url = URL.createObjectURL(result.blob);
    croppedUrlRef.current = url;
    setCropped({ blob: result.blob, url, aspect: result.width / result.height });
    setCropState(result.state);
    setStep("compose");
  };

  const cancelEdit = () => {
    const hasEarlierResult = isVideo ? trimConfirmed || (videoMeta ? videoMeta.duration <= MAX_STORY_SECONDS : false) : cropped !== null;
    if (hasEarlierResult) setStep("compose");
    else onClose();
  };

  // ---------------- stickers & text ----------------

  const patchOverlay = (id: string, patch: Partial<StoryOverlay>) =>
    setOverlays((old) => old.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const removeOverlay = (id: string) => {
    setOverlays((old) => old.filter((o) => o.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  };

  const addSticker = (emoji: string) => {
    if (overlaysRef.current.length >= 30) { setError("You can add up to 30 stickers and texts."); return; }
    const sticker: StoryOverlay = { id: uid(), kind: "sticker", content: emoji, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
    setOverlays((old) => [...old, sticker]);
    setSelectedId(sticker.id);
    setStickerOpen(false);
  };

  const newText = () => {
    setMenuOpen(false);
    setSelectedId(null);
    setEditor({ id: null, text: "", font: "sans", color: "#ffffff", background: false, scale: 1, x: 0.5, y: 0.5, rotation: 0 });
  };
  const editText = (o: StoryOverlay) =>
    setEditor({ id: o.id, text: o.content, font: o.font || "sans", color: o.color || "#ffffff", background: Boolean(o.background), scale: o.scale, x: o.x, y: o.y, rotation: o.rotation });

  const commitText = () => {
    if (!editor) return;
    const content = editor.text.trim();
    if (!content) {
      if (editor.id) removeOverlay(editor.id);
    } else if (editor.id) {
      patchOverlay(editor.id, { content, font: editor.font, color: editor.color, background: editor.background, scale: editor.scale });
      setSelectedId(editor.id);
    } else if (overlaysRef.current.length >= 30) {
      setError("You can add up to 30 stickers and texts.");
    } else {
      const text: StoryOverlay = { id: uid(), kind: "text", content, x: editor.x, y: editor.y, scale: editor.scale, rotation: 0, color: editor.color, font: editor.font, background: editor.background };
      setOverlays((old) => [...old, text]);
      setSelectedId(text.id);
    }
    setEditor(null);
  };

  // ---------------- dragging / pinching an overlay ----------------

  const pinchFrom = (g: Gesture, o: StoryOverlay): Gesture => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return g;
    return { ...g, mode: "pinch", d0: Math.hypot(b.x - a.x, b.y - a.y) || 1, a0: Math.atan2(b.y - a.y, b.x - a.x), s0: o.scale, r0: o.rotation, moved: true };
  };

  const onOverlayDown = (event: ReactPointerEvent<HTMLDivElement>, o: StoryOverlay) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const wasSelected = selectedId === o.id;
    setSelectedId(o.id);

    if (pointers.current.size === 1) {
      gesture.current = { id: o.id, mode: "drag", sx: event.clientX, sy: event.clientY, ox: o.x, oy: o.y, moved: false, wasSelected, d0: 0, a0: 0, s0: o.scale, r0: o.rotation };
    } else if (gesture.current && gesture.current.id === o.id) {
      gesture.current = pinchFrom(gesture.current, o);
    }
  };

  const onOverlayMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      patchOverlay(g.id, {
        scale: clamp(g.s0 * (distance / g.d0), 0.3, 6),
        rotation: normalizeDegrees(g.r0 + ((angle - g.a0) * 180) / Math.PI),
      });
      return;
    }

    if (g.mode === "drag") {
      // Positions are relative to the whole story screen, so text / stickers can also go on the black area.
      const rect = stageNode.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const dx = event.clientX - g.sx;
      const dy = event.clientY - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      if (!g.moved) { g.moved = true; setDragging(true); }
      const halfHeight = rect.height / (2 * rect.width); // vertical range, in screen widths
      patchOverlay(g.id, {
        x: clamp(g.ox + dx / rect.width, 0, 1),
        y: clamp(g.oy + dy / rect.width, 0.5 - halfHeight, 0.5 + halfHeight),
      });

      const trash = trashRef.current?.getBoundingClientRect();
      const over = Boolean(trash && event.clientX >= trash.left && event.clientX <= trash.right && event.clientY >= trash.top && event.clientY <= trash.bottom);
      overTrashRef.current = over;
      setOverTrash(over);
    }
  };

  const onOverlayUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;

    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
      setOverTrash(false);
      const dropped = overTrashRef.current;
      overTrashRef.current = false;
      if (!g) return;
      if (g.mode === "drag" && g.moved && dropped) { removeOverlay(g.id); return; }
      if (!g.moved && g.wasSelected) {
        const o = overlaysRef.current.find((item) => item.id === g.id);
        if (o?.kind === "text") editText(o);
      }
    } else if (pointers.current.size === 1 && g?.mode === "pinch") {
      // One finger left: carry on dragging from where it is.
      const [p] = [...pointers.current.values()];
      const o = overlaysRef.current.find((item) => item.id === g.id);
      if (o && p) gesture.current = { ...g, mode: "drag", sx: p.x, sy: p.y, ox: o.x, oy: o.y, moved: true };
    }
  };

  // ---------------- publish ----------------

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const cleanOverlays: StoryOverlay[] = overlays.map((o) => ({
        id: o.id, kind: o.kind, content: o.content, x: o.x, y: o.y, scale: o.scale, rotation: o.rotation,
        ...(o.kind === "text" ? { color: o.color, font: o.font, background: Boolean(o.background) } : {}),
      }));
      const text = caption.trim();
      let payload: StoryPayload;

      if (isVideo) {
        if (!videoMeta || !trim) throw new Error("The video is not ready yet.");
        const uploaded = await profileService.uploadVideo(
          file,
          { start: Number(trim.start.toFixed(2)), end: Number(trim.end.toFixed(2)) },
        );
        payload = {
          mediaType: "video",
          videoUrl: uploaded.data.secureUrl,
          duration: uploaded.data.duration || trim.end - trim.start,
          aspect: videoMeta.aspect,
          caption: text,
          overlays: cleanOverlays,
        };
      } else {
        if (!cropped) throw new Error("The image is not ready yet.");
        const type = cropped.blob.type || "image/jpeg";
        const imageFile = new File([cropped.blob], `story-${Date.now()}.${extensionOf(type)}`, { type });
        const uploaded = await profileService.uploadImage(imageFile);
        payload = { imageUrl: uploaded.data.secureUrl, aspect: cropped.aspect, caption: text, overlays: cleanOverlays };
      }

      const response = await profileService.createStory(payload);
      onPublished(response.data.story);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to publish your story.");
    } finally {
      setBusy(false);
    }
  };

  // ---------------- render ----------------

  const selected = overlays.find((o) => o.id === selectedId);
  const previewUrl = isVideo ? sourceUrl : cropped?.url ?? "";
  const stop = (event: ReactPointerEvent) => event.stopPropagation();

  const media = isVideo ? (
    <video
      key={sourceUrl}
      ref={videoRef}
      src={previewUrl}
      muted
      playsInline
      autoPlay
      onLoadedMetadata={(e) => {
        if (trimRef.current) e.currentTarget.currentTime = trimRef.current.start;
      }}
      onTimeUpdate={(e) => {
        const range = trimRef.current;
        const v = e.currentTarget;
        if (range && (v.currentTime >= range.end - 0.05 || v.currentTime < range.start - 0.3)) {
          v.currentTime = range.start;
          void v.play().catch(() => undefined);
        }
      }}
      onError={() => setError("This video can't be previewed. Try an MP4 file.")}
      className="h-full w-full object-contain"
    />
  ) : (
    <img src={previewUrl} alt="Story preview" draggable={false} className="h-full w-full object-contain" />
  );

  return createPortal(
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-[#140D0B]">
      <style>{HIDE_SCROLLBAR_CSS}</style>
      <div
        className="relative h-[100dvh] w-full max-w-md select-none overflow-hidden bg-black text-white sm:h-[min(94dvh,880px)] sm:rounded-3xl"
        onPointerDown={() => { setSelectedId(null); setMenuOpen(false); }}
      >
        {step === "loading" && (
          <div className="grid h-full place-items-center">
            {error ? (
              <div className="px-8 text-center">
                <p role="alert" className="rounded-xl bg-red-600/90 px-3 py-2 text-xs font-semibold">{error}</p>
                <button type="button" onClick={onClose} className="mt-4 rounded-full bg-white/15 px-5 py-2 text-sm font-bold">Close</button>
              </div>
            ) : (
              <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
            )}
          </div>
        )}

        {step === "edit" && !isVideo && (
          <StoryImageCropper file={file} initial={cropState} onCancel={cancelEdit} onDone={afterCrop} />
        )}

        {step === "edit" && isVideo && videoMeta && trim && (
          <StoryVideoTrimmer
            url={sourceUrl}
            duration={videoMeta.duration}
            initial={trim}
            onCancel={cancelEdit}
            onDone={(range) => { setTrim(range); setTrimConfirmed(true); setStep("compose"); }}
          />
        )}

        {step === "compose" && (isVideo ? videoMeta && trim : cropped) && (
          <>
            {/* The story exactly as it will look on the story screen. Text / stickers can go anywhere on it, also on the black area. */}
            <div ref={stageRef} className="absolute inset-0 overflow-hidden">
              {media}
              {stage.w > 0 &&
                overlays.filter((o) => o.id !== editor?.id).map((o) => (
                  <OverlayView
                    key={o.id}
                    overlay={o}
                    stage={stage}
                    selected={o.id === selectedId}
                    onPointerDown={(e) => onOverlayDown(e, o)}
                    onPointerMove={onOverlayMove}
                    onPointerUp={onOverlayUp}
                    onPointerCancel={onOverlayUp}
                    style={{ touchAction: "none", cursor: "grab", zIndex: 5 }}
                  />
                ))}
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/55 to-transparent" />

            {/* Top bar: close / edit on the left, the tools drop-down on the right */}
            <div className="absolute left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex items-start justify-between" onPointerDown={stop}>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Close" onClick={onClose} className="rounded-full bg-black/40 p-2"><X size={20} /></button>
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); setStep("edit"); }}
                  className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-2 text-xs font-bold"
                >
                  {isVideo ? <Scissors size={15} /> : <Crop size={15} />} {isVideo ? "Trim" : "Crop"}
                </button>
              </div>

              <div className="flex flex-col items-end">
                <button
                  type="button"
                  aria-label={menuOpen ? "Hide tools" : "Show tools"}
                  aria-expanded={menuOpen}
                  onClick={() => { setSelectedId(null); setMenuOpen((open) => !open); }}
                  className={`p-2 text-white ${dropShadow}`}
                >
                  {menuOpen ? <ChevronUp size={28} strokeWidth={2.5} /> : <ChevronDown size={28} strokeWidth={2.5} />}
                </button>
                {/* Transparent options: only icons + labels, no panel behind them */}
                <div
                  aria-hidden={!menuOpen}
                  inert={!menuOpen}
                  className="flex flex-col items-end gap-1 overflow-hidden transition-all duration-200 ease-out"
                  style={{ maxHeight: menuOpen ? 200 : 0, opacity: menuOpen ? 1 : 0 }}
                >
                  <button
                    type="button"
                    tabIndex={menuOpen ? 0 : -1}
                    onClick={() => { setMenuOpen(false); setStickerOpen(true); }}
                    className={`flex items-center gap-2 bg-transparent px-2 py-2 text-sm font-bold text-white ${dropShadow}`}
                  >
                    Sticker <Smile size={26} />
                  </button>
                  <button
                    type="button"
                    tabIndex={menuOpen ? 0 : -1}
                    onClick={newText}
                    className={`flex items-center gap-2 bg-transparent px-2 py-2 text-sm font-bold text-white ${dropShadow}`}
                  >
                    Text <Type size={26} />
                  </button>
                </div>
              </div>
            </div>

            {/* Controls for the selected sticker / text (pinch with two fingers also works) */}
            {selected && !editor && (
              <div
                className="absolute left-1/2 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2 py-1"
                onPointerDown={stop}
              >
                <button type="button" aria-label="Smaller" onClick={() => patchOverlay(selected.id, { scale: clamp(selected.scale * 0.85, 0.3, 6) })} className="rounded-full p-2"><Minus size={16} /></button>
                <button type="button" aria-label="Bigger" onClick={() => patchOverlay(selected.id, { scale: clamp(selected.scale * 1.18, 0.3, 6) })} className="rounded-full p-2"><Plus size={16} /></button>
                <button type="button" aria-label="Rotate" onClick={() => patchOverlay(selected.id, { rotation: normalizeDegrees(selected.rotation + 15) })} className="rounded-full p-2"><RotateCw size={16} /></button>
                {selected.kind === "text" && <button type="button" aria-label="Edit text" onClick={() => editText(selected)} className="rounded-full p-2"><Pencil size={16} /></button>}
                <button type="button" aria-label="Delete" onClick={() => removeOverlay(selected.id)} className="rounded-full p-2 text-[#ff6b5e]"><Trash2 size={16} /></button>
              </div>
            )}

            {/* Drag a sticker / text here to delete it */}
            {dragging && (
              <div
                ref={trashRef}
                className={`absolute bottom-28 left-1/2 z-30 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full transition ${overTrash ? "scale-125 bg-red-600" : "bg-black/60"}`}
              >
                <Trash2 size={24} />
              </div>
            )}

            {error && (
              <p role="alert" className="absolute left-4 right-4 top-24 z-40 rounded-xl bg-red-600/90 px-3 py-2 text-center text-xs font-semibold" onPointerDown={stop}>
                {error}
                <button type="button" aria-label="Dismiss" onClick={() => setError("")} className="ml-2 align-middle"><X size={13} /></button>
              </p>
            )}

            {/* Caption + post */}
            <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/90 to-transparent p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-12" onPointerDown={stop}>
              <form onSubmit={(e) => { e.preventDefault(); void publish(); }} className="flex items-end gap-2">
                <textarea
                  ref={captionRef}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={1}
                  maxLength={MAX_CAPTION_LENGTH}
                  placeholder="Add a caption…"
                  className="jd-noscroll max-h-[104px] min-h-[46px] min-w-0 flex-1 resize-none rounded-3xl border border-white/40 bg-black/40 px-4 py-3 text-sm leading-snug text-white outline-none placeholder:text-white/70 focus:border-white/80"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="flex h-[46px] shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-5 text-sm font-extrabold text-white shadow disabled:opacity-60"
                >
                  Post <Send size={17} />
                </button>
              </form>
            </div>

            {/* Sticker list */}
            {stickerOpen && (
              <div className="absolute inset-x-0 bottom-0 z-40 flex h-[58%] flex-col rounded-t-3xl bg-[#1d1512] pb-[env(safe-area-inset-bottom)]" onPointerDown={stop}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h3 className="font-bold">Stickers</h3>
                  <button type="button" aria-label="Close stickers" onClick={() => setStickerOpen(false)} className="rounded-full bg-white/10 p-1.5"><X size={18} /></button>
                </div>
                <div className="min-h-0 flex-1 px-2 pb-2">
                  <StickerList onPick={addSticker} />
                </div>
              </div>
            )}

            {/* Text editor */}
            {editor && (
              <div className="absolute inset-0 z-50 flex flex-col bg-black/75" onPointerDown={stop}>
                <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
                  <button type="button" aria-label="Cancel text" onClick={() => setEditor(null)} className="rounded-full bg-white/15 p-2"><X size={20} /></button>
                  <button
                    type="button"
                    aria-label="Toggle text background"
                    aria-pressed={editor.background}
                    onClick={() => setEditor({ ...editor, background: !editor.background })}
                    className={`grid h-10 w-10 place-items-center rounded-full text-lg font-black ${editor.background ? "bg-white text-black" : "bg-white/15 text-white"}`}
                  >
                    A
                  </button>
                  <button type="button" onClick={commitText} className="rounded-full bg-white px-4 py-2 text-sm font-extrabold text-black">Done</button>
                </div>

                <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6">
                  <textarea
                    ref={editorRef}
                    autoFocus
                    value={editor.text}
                    onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                    maxLength={300}
                    rows={1}
                    placeholder="Type something…"
                    className="max-h-full w-full resize-none overflow-hidden border-none bg-transparent outline-none placeholder:text-white/50"
                    style={{
                      ...textStyleOf(editor, overlayFontPx({ kind: "text", scale: editor.scale }, stage.w || 320)),
                      // the chip background is drawn on the box itself while typing
                      width: "100%",
                    }}
                  />
                </div>

                <div className="space-y-3 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
                  <label className="flex items-center gap-3 text-xs font-semibold text-white/80">
                    Size
                    <input
                      type="range"
                      min={0.6}
                      max={3}
                      step={0.05}
                      value={editor.scale}
                      onChange={(e) => setEditor({ ...editor, scale: Number(e.target.value) })}
                      className="h-1 flex-1 accent-white"
                    />
                  </label>

                  <div className="jd-noscroll flex gap-2 overflow-x-auto pb-1">
                    {STORY_FONTS.map((font) => (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => setEditor({ ...editor, font: font.id })}
                        className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${editor.font === font.id ? "bg-white text-black" : "bg-white/15 text-white"}`}
                      >
                        <span className="block text-xl leading-tight" style={{ fontFamily: font.family, fontWeight: font.weight }}>Aa</span>
                        <span className="block text-[10px] font-semibold">{font.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="jd-noscroll flex gap-2.5 overflow-x-auto pb-1">
                    {STORY_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Colour ${color}`}
                        onClick={() => setEditor({ ...editor, color })}
                        className={`h-8 w-8 shrink-0 rounded-full border-2 ${editor.color === color ? "scale-110 border-white" : "border-white/40"}`}
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {busy && (
              <div className="absolute inset-0 z-[60] grid place-items-center bg-black/60" onPointerDown={stop}>
                <div className="flex flex-col items-center gap-3">
                  <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
                  <span className="text-sm font-semibold">{isVideo ? "Uploading video…" : "Posting story…"}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
