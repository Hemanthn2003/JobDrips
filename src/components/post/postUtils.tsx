import type { PostData } from "../../services/postService";

export const getPostImages = (post: Pick<PostData, "imageUrl">): string[] =>
  Object.values(post.imageUrl ?? {}).filter(
    (image): image is string => typeof image === "string" && image.trim() !== "",
  );

/** "Just now", "5 min ago", "1 hr ago", "2 days ago" ... */
export const timeAgoLong = (value?: string): string => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";

  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return new Date(time).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: new Date(time).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
};

export const timeAgoShort = (value?: string): string => {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(time).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: new Date(time).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
};

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "J";

export function PersonAvatar({
  src,
  name,
  className = "h-10 w-10",
}: {
  src?: string;
  name: string;
  className?: string;
}) {
  return src ? (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className={`shrink-0 rounded-full border border-[#eee4dd] object-cover ${className}`}
    />
  ) : (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#eadbd0] text-[11px] font-bold text-[#654536] ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}

/** Text with @mentions and #hashtags highlighted. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(@[A-Za-z0-9_.]{3,30}|#[A-Za-z0-9_]+)/g);

  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("@") || part.startsWith("#") ? (
          <span key={index} className="font-semibold text-[#9a6e58]">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
