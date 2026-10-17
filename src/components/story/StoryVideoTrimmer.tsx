import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, Pause, Play, X } from "lucide-react";
import { MAX_STORY_SECONDS } from "./storyOverlays";

// Trim step of the story editor (like Instagram): a strip of frames with a
// selection window. The window can never be longer than 60 seconds.

export type TrimRange = { start: number; end: number };
const MIN_SECONDS = 1;
const THUMBS = 8;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mmss = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

type Props = {
  url: string;
  duration: number;
  initial: TrimRange;
  onCancel: () => void;
  onDone: (range: TrimRange) => void;
};

export default function StoryVideoTrimmer({ url, duration, initial, onCancel, onDone }: Props) {
  const [range, setRange] = useState<TrimRange>(initial);
  const [time, setTime] = useState(initial.start);
  const [playing, setPlaying] = useState(false);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [error, setError] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rangeRef = useRef(range);
  const drag = useRef<{ mode: "start" | "end" | "window"; startTime: number; range: TrimRange } | null>(null);
  rangeRef.current = range;

  // Frame strip (best effort: if the browser can't seek, the plain track is shown).
  useEffect(() => {
    let alive = true;
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = url;

    const grab = (at: number) =>
      new Promise<string>((resolve) => {
        const timer = window.setTimeout(() => resolve(""), 2500);
        video.onseeked = () => {
          window.clearTimeout(timer);
          try {
            const canvas = document.createElement("canvas");
            canvas.width = 80;
            canvas.height = 112;
            const ctx = canvas.getContext("2d");
            if (!ctx || !video.videoWidth) { resolve(""); return; }
            const cover = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
            const w = video.videoWidth * cover;
            const h = video.videoHeight * cover;
            ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.6));
          } catch { resolve(""); }
        };
        video.currentTime = at;
      });

    const run = async () => {
      await new Promise<void>((resolve) => {
        if (video.readyState >= 1) { resolve(); return; }
        video.onloadedmetadata = () => resolve();
        video.onerror = () => resolve();
      });
      const frames: string[] = [];
      for (let i = 0; i < THUMBS && alive; i += 1) {
        frames.push(await grab(((i + 0.5) / THUMBS) * duration));
        if (alive) setThumbs([...frames]);
      }
    };
    void run();

    return () => { alive = false; video.removeAttribute("src"); video.load(); };
  }, [url, duration]);

  // Start the preview at the beginning of the selection.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (video) video.currentTime = initial.start;
  }, [initial.start]);

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setTime(seconds);
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const { start, end } = rangeRef.current;
    if (video.currentTime >= end - 0.05 || video.currentTime < start - 0.3) {
      video.currentTime = start;
      if (!video.paused) void video.play().catch(() => undefined);
    }
    setTime(video.currentTime);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime >= range.end - 0.1 || video.currentTime < range.start) video.currentTime = range.start;
      void video.play().catch(() => setError("Tap play again to preview the video."));
    } else video.pause();
  };

  const timeAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };

  const begin = (mode: "start" | "end" | "window") => (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    videoRef.current?.pause();
    drag.current = { mode, startTime: timeAt(event.clientX), range };
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = timeAt(event.clientX);

    if (d.mode === "start") {
      const start = clamp(now, Math.max(0, d.range.end - MAX_STORY_SECONDS), d.range.end - Math.min(MIN_SECONDS, duration));
      setRange({ start, end: d.range.end });
      seek(start);
    } else if (d.mode === "end") {
      const end = clamp(now, d.range.start + Math.min(MIN_SECONDS, duration), Math.min(duration, d.range.start + MAX_STORY_SECONDS));
      setRange({ start: d.range.start, end });
      seek(Math.max(d.range.start, end - 0.1));
    } else {
      const length = d.range.end - d.range.start;
      const start = clamp(d.range.start + (now - d.startTime), 0, duration - length);
      setRange({ start, end: start + length });
      seek(start);
    }
  };

  const release = () => { drag.current = null; };

  const length = range.end - range.start;
  const pct = (seconds: number) => `${(seconds / duration) * 100}%`;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-[#0f0a08] text-white">
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" aria-label="Cancel" onClick={onCancel} className="rounded-full bg-white/10 p-2"><X size={20} /></button>
        <span className="text-sm font-bold">Trim video</span>
        <button
          type="button"
          onClick={() => onDone(range)}
          className="flex items-center gap-1.5 rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-4 py-2 text-sm font-extrabold"
        ><Check size={16} /> Next</button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        <video
          ref={videoRef}
          src={url}
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={onTimeUpdate}
          onError={() => setError("This video can't be previewed. Try an MP4 file.")}
          className="max-h-full max-w-full rounded-2xl bg-black"
        />
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={togglePlay}
          className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50"
        >
          {playing ? <Pause size={26} /> : <Play size={26} className="translate-x-0.5" />}
        </button>
        {error && <p role="alert" className="absolute inset-x-6 top-2 rounded-xl bg-red-600/90 px-3 py-2 text-center text-xs font-semibold">{error}</p>}
      </div>

      <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <div className="mb-3 flex items-center justify-between text-xs font-semibold">
          <span>{mmss(range.start)} – {mmss(range.end)}</span>
          <span className={length >= MAX_STORY_SECONDS - 0.05 ? "text-[#ffcc00]" : "text-white/80"}>
            {mmss(length)} selected{duration > MAX_STORY_SECONDS ? ` · max ${MAX_STORY_SECONDS} s` : ""}
          </span>
        </div>

        <div ref={trackRef} className="relative h-16 touch-none select-none rounded-xl bg-white/10">
          <div className="absolute inset-0 flex overflow-hidden rounded-xl">
            {Array.from({ length: THUMBS }, (_, i) => (
              <div key={i} className="h-full flex-1 bg-cover bg-center" style={thumbs[i] ? { backgroundImage: `url(${thumbs[i]})` } : undefined} />
            ))}
          </div>

          {/* dimmed parts outside the selection */}
          <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-xl bg-black/65" style={{ width: pct(range.start) }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-xl bg-black/65" style={{ width: `${100 - (range.end / duration) * 100}%` }} />

          {/* selection window: drag to move it, drag the yellow ends to resize */}
          <div
            onPointerDown={begin("window")}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
            className="absolute inset-y-0 cursor-grab border-y-[3px] border-[#ffcc00]"
            style={{ left: pct(range.start), width: pct(length), touchAction: "none" }}
          >
            <span
              onPointerDown={begin("start")}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
              className="absolute -left-3 top-[-3px] bottom-[-3px] grid w-5 cursor-ew-resize place-items-center rounded-l-md bg-[#ffcc00]"
              style={{ touchAction: "none" }}
            ><span className="h-6 w-0.5 rounded bg-black/60" /></span>
            <span
              onPointerDown={begin("end")}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
              className="absolute -right-3 top-[-3px] bottom-[-3px] grid w-5 cursor-ew-resize place-items-center rounded-r-md bg-[#ffcc00]"
              style={{ touchAction: "none" }}
            ><span className="h-6 w-0.5 rounded bg-black/60" /></span>
          </div>

          <div className="pointer-events-none absolute inset-y-[-4px] w-0.5 rounded bg-white shadow" style={{ left: pct(clamp(time, 0, duration)) }} />
        </div>

        {duration > MAX_STORY_SECONDS && (
          <p className="mt-3 text-center text-[11px] text-white/60">Stories can be up to {MAX_STORY_SECONDS} seconds. Drag the highlighted part to choose which section to share.</p>
        )}
      </div>
    </div>
  );
}
