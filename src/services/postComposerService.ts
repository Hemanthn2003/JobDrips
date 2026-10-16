/** API client for the Add Post page. Authentication uses the app's HTTP-only cookie. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
const BASE = `${API_BASE}/api/post-composer`;

export interface ComposerContext {
  userId: string;
  username: string;
  fullName: string;
  profileImage: string;
}

export interface HashtagSuggestion {
  hashtagId: string;
  hashtag: string;
  usesCount: number;
}

export interface MentionSuggestion {
  userId: string;
  username: string;
  fullName: string;
  profileImage: string;
}

export interface PollDraft {
  question: string;
  options: string[];
  durationDays: 1 | 3 | 7;
}

export interface CreatePostInput {
  caption: string;
  images: File[];
  video?: { file: File; start: number; end: number };
  poll?: PollDraft;
  settings: {
    hideLikeCount: boolean;
    hideSaveCount: boolean;
    hideShareCount: boolean;
    hideComments: boolean;
  };
}

const request = async <T>(path: string, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
};

export const postComposerService = {
  getContext: () => request<ComposerContext>("/context"),

  searchHashtags: async (q: string, signal?: AbortSignal) =>
    (await request<{ hashtags: HashtagSuggestion[] }>(`/hashtags?q=${encodeURIComponent(q)}`, signal))
      .hashtags,

  searchMentions: async (q: string, signal?: AbortSignal) =>
    (await request<{ users: MentionSuggestion[] }>(`/mentions?q=${encodeURIComponent(q)}`, signal))
      .users,

  /** XHR (not fetch) so we can report upload progress for big videos. */
  createPost: (input: CreatePostInput, onProgress?: (percent: number) => void) =>
    new Promise<unknown>((resolve, reject) => {
      const form = new FormData();
      form.append("caption", input.caption);
      form.append("settings", JSON.stringify(input.settings));
      if (input.poll) form.append("poll", JSON.stringify(input.poll));
      input.images.forEach((f) => form.append("images", f, f.name));
      if (input.video) {
        form.append("videoStart", String(input.video.start));
        form.append("videoEnd", String(input.video.end));
        form.append("video", input.video.file, input.video.file.name);
      }

      const xhr = new XMLHttpRequest();
      xhr.open("POST", BASE);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onerror = () => reject(new Error("Network error. Check your connection and try again."));
      xhr.onload = () => {
        let body: { message?: string } = {};
        try {
          body = JSON.parse(xhr.responseText) as { message?: string };
        } catch {
          // Use the HTTP status when the server did not return JSON.
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.message ?? `Could not create the post (${xhr.status}).`));
      };
      xhr.send(form);
    }),
};
