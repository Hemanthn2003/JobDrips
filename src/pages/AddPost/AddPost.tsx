import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import CaptionInput from "../../components/post/CaptionInput";
import ConfirmModal from "../../components/common/PostConfrimModal";
import ImageCropModal from "../../components/post/ImageCropModal";
import PollComposer, { isPollValid } from "../../components/post/PollComposer";
import VideoTrimModal, { MAX_VIDEO_SECONDS, formatTime } from "../../components/post/VideoTrimModal";
import {
  IconClose,
  IconCrop,
  IconPhoto,
  IconPlus,
  IconPoll,
  IconScissors,
  IconVideo,
} from "../../components/post/PostIcons";
import { postComposerService } from "../../services/postComposerService";
import type { ComposerContext, PollDraft } from "../../services/postComposerService";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const FEED_ROUTE = "/feed";

interface ImageItem {
  id: string;
  original: File; // never modified
  file: File; // what gets uploaded (original, or the cropped version)
  originalUrl: string;
  previewUrl: string;
  edited: boolean;
}

interface VideoItem {
  file: File;
  url: string;
  duration: number;
  start: number;
  end: number;
}

const newPoll = (): PollDraft => ({ question: "", options: ["", ""], durationDays: 1 });

const readVideoDuration = (url: string) =>
  new Promise<number>((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) resolve(v.duration);
      else reject(new Error("Could not read the video length."));
    };
    v.onerror = () => reject(new Error("This video format isn't supported by your browser."));
    v.src = url;
  });

/** Plays only the chosen section of the video, looping. */
const TrimmedPreview = ({ item }: { item: VideoItem }) => {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= item.end || v.currentTime < item.start - 0.3) {
        v.currentTime = item.start;
        if (!v.paused) void v.play().catch(() => undefined);
      }
    };
    v.currentTime = item.start;
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [item.start, item.end, item.url]);

  return (
    <video
      ref={ref}
      src={item.url}
      controls
      playsInline
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = item.start;
      }}
      className="max-h-[460px] w-full rounded-2xl bg-black object-contain"
    />
  );
};

const AddPost = () => {
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<ComposerContext | null>(null);
  const [caption, setCaption] = useState("");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [poll, setPoll] = useState<PollDraft | null>(null);

  // Checkbox UI is "Show …" (checked = visible); the schema stores hide* flags.
  const [showLike, setShowLike] = useState(true);
  const [showSave, setShowSave] = useState(true);
  const [showShare, setShowShare] = useState(true);
  const [turnOffComments, setTurnOffComments] = useState(false);

  const [cropping, setCropping] = useState<ImageItem | null>(null);
  const [trimming, setTrimming] = useState<VideoItem | null>(null);
  const [pendingVideo, setPendingVideo] = useState<VideoItem | null>(null); // new upload being trimmed
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [posting, setPosting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  /* ---- header (name + avatar) ---- */
  useEffect(() => {
    postComposerService
      .getContext()
      .then(setCtx)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load your profile.");
      });
  }, []);

  /* ---- free object URLs on leave ---- */
  const live = useRef({ images, video });
  live.current = { images, video };
  useEffect(
    () => () => {
      live.current.images.forEach((i) => {
        URL.revokeObjectURL(i.originalUrl);
        if (i.previewUrl !== i.originalUrl) URL.revokeObjectURL(i.previewUrl);
      });
      if (live.current.video) URL.revokeObjectURL(live.current.video.url);
    },
    []
  );

  const dirty =
    caption.trim().length > 0 ||
    images.length > 0 ||
    !!video ||
    (!!poll && (poll.question.trim() !== "" || poll.options.some((o) => o.trim() !== "")));

  /* ---- warn before closing the tab with unsaved work (browser-native prompt) ---- */
  useEffect(() => {
    if (!dirty || posting) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, posting]);

  /* ───────────── photos ───────────── */
  const addPhotos = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!picked.length) return;
    setError("");

    const room = MAX_IMAGES - images.length;
    const accepted: ImageItem[] = [];
    for (const f of picked.slice(0, room)) {
      if (!f.type.startsWith("image/")) {
        setError("Only image files can be added as photos.");
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setError(`"${f.name}" is larger than 20 MB.`);
        continue;
      }
      const url = URL.createObjectURL(f);
      accepted.push({
        id: `${f.name}-${f.size}-${crypto.randomUUID()}`,
        original: f,
        file: f,
        originalUrl: url,
        previewUrl: url,
        edited: false,
      });
    }
    if (picked.length > room) setError(`You can add up to ${MAX_IMAGES} photos.`);
    if (accepted.length) setImages((prev) => [...prev, ...accepted]);
  };

  const removeImage = (id: string) =>
    setImages((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.originalUrl);
        if (gone.previewUrl !== gone.originalUrl) URL.revokeObjectURL(gone.previewUrl);
      }
      return prev.filter((i) => i.id !== id);
    });

  const applyCrop = (
    item: ImageItem,
    result: { blob: Blob; width: number; height: number } | null
  ) => {
    setImages((prev) =>
      prev.map((i) => {
        if (i.id !== item.id) return i;
        if (i.previewUrl !== i.originalUrl) URL.revokeObjectURL(i.previewUrl);
        if (!result) {
          // no change → back to the untouched original
          return { ...i, file: i.original, previewUrl: i.originalUrl, edited: false };
        }
        const base = i.original.name.replace(/\.[^.]+$/, "");
        const ext = result.blob.type === "image/png" ? "png" : result.blob.type === "image/webp" ? "webp" : "jpg";
        const file = new File([result.blob], `${base}-edited.${ext}`, { type: result.blob.type });
        return { ...i, file, previewUrl: URL.createObjectURL(result.blob), edited: true };
      })
    );
    setCropping(null);
  };

  /* ───────────── video ───────────── */
  const addVideo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError("");
    if (!f.type.startsWith("video/")) return setError("Please choose a video file.");
    if (f.size > MAX_VIDEO_BYTES) return setError("Videos can be up to 300 MB.");

    const url = URL.createObjectURL(f);
    try {
      const duration = await readVideoDuration(url);
      const item: VideoItem = {
        file: f,
        url,
        duration,
        start: 0,
        end: Math.min(duration, MAX_VIDEO_SECONDS),
      };
      if (duration > MAX_VIDEO_SECONDS) {
        setPendingVideo(item); // must pick a ≤ 90s section before it's attached
        setTrimming(item);
      } else {
        setVideo(item);
      }
    } catch (err) {
      URL.revokeObjectURL(url);
      setError(err instanceof Error ? err.message : "Could not load the video.");
    }
  };

  const removeVideo = () => {
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
  };

  const finishTrim = (range: { start: number; end: number }) => {
    if (!trimming) return;
    const next = { ...trimming, ...range };
    setVideo(next);
    setPendingVideo(null);
    setTrimming(null);
  };

  const cancelTrim = () => {
    if (pendingVideo) URL.revokeObjectURL(pendingVideo.url); // a brand-new, too-long video: discard
    setPendingVideo(null);
    setTrimming(null);
  };

  /* ───────────── post / cancel ───────────── */
  const pollOk = !poll || isPollValid(poll);
  const hasContent = caption.trim().length > 0 || images.length > 0 || !!video || (!!poll && isPollValid(poll));
  const canPost = hasContent && pollOk && !posting;

  const submit = useCallback(async () => {
    if (!canPost) return;
    setError("");
    setPosting(true);
    setProgress(0);
    try {
      await postComposerService.createPost(
        {
          caption: caption.trim(),
          images: images.map((i) => i.file),
          video: video ? { file: video.file, start: video.start, end: video.end } : undefined,
          poll: poll
            ? { ...poll, question: poll.question.trim(), options: poll.options.map((o) => o.trim()).filter(Boolean) }
            : undefined,
          settings: {
            hideLikeCount: !showLike,
            hideSaveCount: !showSave,
            hideShareCount: !showShare,
            hideComments: turnOffComments,
          },
        },
        setProgress
      );
      navigate(FEED_ROUTE, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the post.");
      setPosting(false);
    }
  }, [canPost, caption, images, video, poll, showLike, showSave, showShare, turnOffComments, navigate]);

  const cancel = () => {
    if (posting) return;
    if (dirty) setConfirmDiscard(true);
    else navigate(FEED_ROUTE);
  };

  const discard = () => {
    // Leaving the page unmounts it, which frees all previews and drops every change.
    setConfirmDiscard(false);
    navigate(FEED_ROUTE, { replace: true });
  };

  const initial = ctx?.fullName?.[0] ?? ctx?.username?.[0] ?? "";

  const checkboxes = useMemo(
    () => [
      { label: "Show like count", checked: showLike, set: setShowLike },
      { label: "Show save count", checked: showSave, set: setShowSave },
      { label: "Show share count", checked: showShare, set: setShowShare },
      { label: "Turn off comments", checked: turnOffComments, set: setTurnOffComments },
    ],
    [showLike, showSave, showShare, turnOffComments]
  );

  const mediaLocked = images.length > 0 ? "video" : video ? "photo" : null;

  return (
    <div className="min-h-screen bg-[var(--jd-background,#FBF3EF)] pb-[130px]">
      {/* ───── header ───── */}
      <header className="sticky top-0 z-30 border-b border-[var(--jd-border,#EBD7CD)] bg-[#FBF3EF]/95 backdrop-blur">
        <div className="mx-auto flex h-[60px] w-full max-w-[680px] items-center justify-between px-4">
          <button
            type="button"
            onClick={cancel}
            disabled={posting}
            className="rounded-lg px-1 py-2 text-[16px] font-semibold text-[#A5472F] disabled:opacity-50"
          >
            Cancel
          </button>
          <h1 className="text-[18px] font-extrabold text-[#2b1a14]">Create Post</h1>
          <button
            type="button"
            onClick={submit}
            disabled={!canPost}
            className="rounded-xl bg-gradient-to-b from-[#C8704F] to-[#A5472F] px-6 py-2 text-[16px] font-bold text-white shadow-[0_4px_14px_rgba(165,71,47,0.3)] transition disabled:opacity-45 disabled:shadow-none"
          >
            {posting ? "Posting…" : "Post"}
          </button>
        </div>
        {posting && (
          <div className="h-1 w-full bg-[#F1DDD3]">
            <div className="h-full bg-[#A5472F] transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-[680px] space-y-4 px-4 pt-4">
        {/* ───── author ───── */}
        <div className="flex items-center gap-3">
          {ctx?.profileImage ? (
            <img src={ctx.profileImage} alt="" className="h-[58px] w-[58px] rounded-2xl object-cover" />
          ) : (
            <span className="flex h-[58px] w-[58px] items-center justify-center rounded-2xl bg-[#F1D9CD] text-[22px] font-black uppercase text-[#A5472F]">
              {initial}
            </span>
          )}
          <div>
            <p className="text-[17px] font-extrabold leading-tight text-[#2b1a14]">
              {ctx?.fullName || ctx?.username || "You"}
            </p>
            {ctx?.username && (
              <p className="text-[13px] font-medium text-[#a68f84]">@{ctx.username}</p>
            )}
          </div>
        </div>

        {/* ───── caption ───── */}
        <CaptionInput value={caption} onChange={setCaption} />

        {/* ───── attach buttons ───── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              key: "photo",
              label: "Photo",
              icon: <IconPhoto className="h-8 w-8" />,
              onClick: () => photoInput.current?.click(),
              disabled: mediaLocked === "photo" || images.length >= MAX_IMAGES,
              hint: mediaLocked === "photo" ? "Remove the video to add photos" : "",
            },
            {
              key: "video",
              label: "Video",
              icon: <IconVideo className="h-8 w-8" />,
              onClick: () => videoInput.current?.click(),
              disabled: mediaLocked === "video" || !!video,
              hint: mediaLocked === "video" ? "Remove the photos to add a video" : "",
            },
            {
              key: "poll",
              label: "Poll",
              icon: <IconPoll className="h-8 w-8" />,
              onClick: () => setPoll((p) => p ?? newPoll()),
              disabled: !!poll,
              hint: "",
            },
          ].map((b) => (
            <button
              key={b.key}
              type="button"
              onClick={b.onClick}
              disabled={b.disabled}
              title={b.hint}
              className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--jd-border,#EBD7CD)] bg-white/55 py-3.5 text-[13px] font-semibold text-[#3b2a23] transition active:scale-[0.97] disabled:opacity-40"
            >
              <span className="text-[#A5472F]">{b.icon}</span>
              {b.label}
            </button>
          ))}
          <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={addPhotos} />
          <input ref={videoInput} type="file" accept="video/*" hidden onChange={addVideo} />
        </div>

        {/* ───── photos (shown whole — never cropped unless you crop) ───── */}
        {images.length > 0 && (
          <section className="grid grid-cols-2 gap-3">
            {images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#E2C3B5] bg-white/40 text-[14px] font-semibold text-[#A5472F]"
              >
                <IconPlus className="h-9 w-9" />
                Add Photos
              </button>
            )}
            {images.map((img) => (
              <div
                key={img.id}
                className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-[#EFE1DA]"
              >
                <img src={img.previewUrl} alt="" className="h-full w-full object-contain" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-0.5 text-[11px] font-bold text-white">
                  {img.edited ? "Cropped" : "Original"}
                </span>
                <button
                  type="button"
                  aria-label="Edit / crop photo"
                  onClick={() => setCropping(img)}
                  className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/95 text-[#A5472F] shadow"
                >
                  <IconCrop className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removeImage(img.id)}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#2b1a14] shadow"
                >
                  <IconClose className="h-[18px] w-[18px]" />
                </button>
              </div>
            ))}
          </section>
        )}

        {/* ───── video ───── */}
        {video && (
          <section className="space-y-2.5">
            <div className="relative">
              <TrimmedPreview item={video} />
              <button
                type="button"
                aria-label="Remove video"
                onClick={removeVideo}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#2b1a14] shadow"
              >
                <IconClose className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--jd-border,#EBD7CD)] bg-white/60 px-3.5 py-2.5">
              <p className="text-[13px] font-semibold text-[#3b2a23]">
                {formatTime(video.end - video.start)} selected
                <span className="font-medium text-[#a68f84]">
                  {" "}
                  · {formatTime(video.start)} → {formatTime(video.end)} of {formatTime(video.duration)}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setTrimming(video)}
                className="flex items-center gap-1.5 rounded-full bg-[#A5472F] px-3.5 py-1.5 text-[13px] font-bold text-white"
              >
                <IconScissors className="h-4 w-4" />
                Trim
              </button>
            </div>
          </section>
        )}

        {/* ───── poll ───── */}
        {poll && <PollComposer value={poll} onChange={setPoll} onRemove={() => setPoll(null)} />}

        {/* ───── post settings ───── */}
        <section className="space-y-2.5 pt-1">
          {checkboxes.map((c) => (
            <label
              key={c.label}
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[var(--jd-border,#EBD7CD)] bg-white/60 px-4 py-3.5 text-[15px] font-medium text-[#3b2a23]"
            >
              <input
                type="checkbox"
                checked={c.checked}
                onChange={(e) => c.set(e.target.checked)}
                className="h-[18px] w-[18px] cursor-pointer accent-[#6B3E2E]"
              />
              {c.label}
            </label>
          ))}
        </section>

        {error && (
          <p role="alert" className="rounded-xl border border-[#E8B4A6] bg-[#FDECE7] px-4 py-3 text-[14px] font-semibold text-[#9A2F1B]">
            {error}
          </p>
        )}
      </main>

      {/* ───── editors ───── */}
      {cropping && (
        <ImageCropModal
          src={cropping.originalUrl}
          mimeType={cropping.original.type}
          onCancel={() => setCropping(null)}
          onDone={(result) => applyCrop(cropping, result)}
        />
      )}

      {trimming && (
        <VideoTrimModal
          src={trimming.url}
          duration={trimming.duration}
          initial={{ start: trimming.start, end: trimming.end }}
          onCancel={cancelTrim}
          onDone={finishTrim}
        />
      )}

      {/* ───── discard confirmation (shared modal) ───── */}
      <ConfirmModal
        open={confirmDiscard}
        title="Discard this post?"
        message="Everything you've added here will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        danger
        onConfirm={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
};

export default AddPost;