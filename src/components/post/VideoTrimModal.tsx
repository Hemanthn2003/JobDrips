import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { IconPause, IconPlay } from "./PostIcons";

export const MAX_VIDEO_SECONDS = 90;
const MIN_SECONDS = 1;
const THUMBS = 9;

export const formatTime = (s: number) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type Drag = "start" | "end" | "move";

interface Props {
  src: string;
  duration: number;
  initial: { start: number; end: number };
  onCancel: () => void;
  onDone: (range: { start: number; end: number }) => void;
}

/**
 * Instagram / WhatsApp style trimmer.
 * The selection can never be longer than 90s: dragging one handle past the
 * limit is blocked, and the middle of the selection slides the whole window.
 */
const VideoTrimModal = ({ src, duration, initial, onCancel, onDone }: Props) => {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(initial.start);
  const [thumbs, setThumbs] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ type: Drag; x: number; start: number; end: number } | null>(null);
  const rangeRef = useRef({ start, end });
  rangeRef.current = { start, end };

  const maxLen = Math.min(MAX_VIDEO_SECONDS, duration);
  const minLen = Math.min(MIN_SECONDS, duration);

  /* ---- lock page scroll ---- */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* ---- filmstrip thumbnails (best effort) ---- */
  useEffect(() => {
    let alive = true;
    const v = document.createElement("video");
    v.src = src;
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;

    const run = async () => {
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej();
      });
      const canvas = document.createElement("canvas");
      const h = 64;
      const w = Math.round((h * (v.videoWidth || 16)) / (v.videoHeight || 9));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const out: string[] = [];
      for (let i = 0; i < THUMBS && alive; i++) {
        v.currentTime = ((i + 0.5) / THUMBS) * duration;
        await new Promise<void>((res) => {
          v.onseeked = () => res();
        });
        ctx.drawImage(v, 0, 0, w, h);
        out.push(canvas.toDataURL("image/jpeg", 0.6));
        if (alive) setThumbs([...out]);
      }
    };
    run().catch(() => undefined);

    return () => {
      alive = false;
      v.removeAttribute("src");
      v.load();
    };
  }, [src, duration]);

  /* ---- loop playback inside the selection ---- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      const { start: s, end: e } = rangeRef.current;
      setPlayhead(v.currentTime);
      if (v.currentTime >= e || v.currentTime < s - 0.3) {
        v.currentTime = s;
        if (!v.paused) void v.play().catch(() => undefined);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.currentTime = initial.start;
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = t;
    setPlayhead(t);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end) v.currentTime = start;
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  };

  /* ---- dragging ---- */
  const pxToSeconds = useCallback(
    (px: number) => {
      const w = trackRef.current?.clientWidth || 1;
      return (px / w) * duration;
    },
    [duration]
  );

  const bind = (type: Drag) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      videoRef.current?.pause();
      drag.current = { type, x: e.clientX, start, end };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dt = pxToSeconds(e.clientX - d.x);

      if (d.type === "start") {
        const s = clamp(d.start + dt, Math.max(0, d.end - maxLen), d.end - minLen);
        setStart(s);
        seek(s);
      } else if (d.type === "end") {
        const en = clamp(d.end + dt, d.start + minLen, Math.min(duration, d.start + maxLen));
        setEnd(en);
        seek(Math.max(d.start, en - 0.1));
      } else {
        const len = d.end - d.start;
        const s = clamp(d.start + dt, 0, duration - len);
        setStart(s);
        setEnd(s + len);
        seek(s);
      }
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  });

  const length = end - start;
  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#120d0b] text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-[15px] font-semibold text-white/80">
          Cancel
        </button>
        <h2 className="text-[16px] font-extrabold">Trim video</h2>
        <button
          type="button"
          onClick={() => onDone({ start, end })}
          className="rounded-full bg-gradient-to-b from-[#C8704F] to-[#A5472F] px-5 py-1.5 text-[15px] font-bold"
        >
          Done
        </button>
      </div>

      {/* preview */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">
        <video
          ref={videoRef}
          src={src}
          playsInline
          onClick={togglePlay}
          className="max-h-full max-w-full rounded-xl bg-black object-contain"
        />
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute bottom-4 left-1/2 flex h-12 w-12 -translate-x-1/2 items-center justify-center rounded-full bg-black/55 backdrop-blur"
        >
          {playing ? <IconPause className="h-6 w-6" /> : <IconPlay className="h-6 w-6" />}
        </button>
      </div>

      {/* timeline */}
      <div className="px-4 pb-7 pt-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <p className="text-[22px] font-extrabold leading-none">{formatTime(length)}</p>
            <p className="mt-1 text-[12px] font-semibold text-white/60">
              selected of {formatTime(duration)}
              {duration > MAX_VIDEO_SECONDS ? ` · max ${MAX_VIDEO_SECONDS}s` : ""}
            </p>
          </div>
          <p className="text-right text-[12px] font-semibold text-white/60">
            {formatTime(start)} → {formatTime(end)}
          </p>
        </div>

        <div className="px-3">
          <div ref={trackRef} className="relative h-14 select-none rounded-lg bg-white/10" style={{ touchAction: "none" }}>
            {/* filmstrip */}
            <div className="absolute inset-0 flex overflow-hidden rounded-lg">
              {thumbs.map((t, i) => (
                <img key={i} src={t} alt="" draggable={false} className="h-full flex-1 object-cover" />
              ))}
            </div>

            {/* dim outside the selection */}
            <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/65" style={{ width: pct(start) }} />
            <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/65" style={{ width: pct(duration - end) }} />

            {/* selection window (drag to slide) */}
            <div
              {...bind("move")}
              className="absolute inset-y-[-3px] cursor-grab border-y-[3px] border-[#E39A7D]"
              style={{ left: pct(start), width: pct(length), touchAction: "none" }}
            >
              <span
                {...bind("start")}
                className="absolute -left-3 inset-y-[-3px] flex w-4 cursor-ew-resize items-center justify-center rounded-l-md bg-[#E39A7D]"
                style={{ touchAction: "none" }}
              >
                <span className="h-5 w-0.5 rounded bg-[#2a140c]/70" />
              </span>
              <span
                {...bind("end")}
                className="absolute -right-3 inset-y-[-3px] flex w-4 cursor-ew-resize items-center justify-center rounded-r-md bg-[#E39A7D]"
                style={{ touchAction: "none" }}
              >
                <span className="h-5 w-0.5 rounded bg-[#2a140c]/70" />
              </span>
            </div>

            {/* playhead */}
            <div
              className="pointer-events-none absolute inset-y-[-6px] w-0.5 rounded bg-white"
              style={{ left: pct(clamp(playhead, 0, duration)) }}
            />
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] text-white/55">
          Drag the handles to trim · drag the middle to slide the selection
        </p>
      </div>
    </div>
  );
};

export default VideoTrimModal;
