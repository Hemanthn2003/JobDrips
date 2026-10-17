import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Story } from "../../services/profileService";
import StoryComposer from "./StoryComposer";

// One "add story" flow shared by the Profile page (+ on the photo) and the
// Messages page (Add story button): pick a photo / video, edit it, post it.

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // large photos are re-compressed below 5 MB when posted
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

type Options = {
  /** Called with the saved story after it was published. */
  onPublished: (story: Story) => void;
  /** Called with a readable message when the picked file can't be used. */
  onError?: (message: string) => void;
};

export function useAddStory({ onPublished, onError }: Options): { pickStory: () => void; storyElement: ReactNode } {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const pickStory = () => inputRef.current?.click();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = ""; // the same file can be picked again later
    if (!picked) return;

    const isImage = IMAGE_TYPES.includes(picked.type);
    const isVideo = VIDEO_TYPES.includes(picked.type);

    if (!isImage && !isVideo) { onError?.("Choose a JPG, PNG or WebP image, or an MP4, WebM or MOV video."); return; }
    if (isImage && picked.size > MAX_IMAGE_BYTES) { onError?.("Images must be 25 MB or smaller."); return; }
    if (isVideo && picked.size > MAX_VIDEO_BYTES) { onError?.("Videos must be 200 MB or smaller."); return; }

    setFile(picked);
  };

  const storyElement = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
        className="hidden"
        onChange={onChange}
      />
      {file && (
        <StoryComposer
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          onClose={() => setFile(null)}
          onPublished={onPublished}
        />
      )}
    </>
  );

  return { pickStory, storyElement };
}
