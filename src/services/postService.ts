const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"
).replace(/\/+$/, "");

// --------------------------------------------------
// Types
// --------------------------------------------------

export interface PostPerson {
  userid: string;
  username: string;
  name?: string;
  profileimage: string;
}

export interface MentionRef {
  userId: string;
  username: string;
}

export interface PostComment {
  commentId: string;
  userId: string;
  username: string;
  profileImage: string;
  commentText: string;
  parentCommentId: string | null;
  mentions: MentionRef[];
  likeCount: number;
  liked: boolean;
  createdAt: string;
  updatedAt?: string;
  edited?: boolean;
}

export interface PostSettings {
  hideLikeCount: boolean;
  hideComments: boolean;
  hideShareCount: boolean;
  hideSaveCount: boolean;
}

export interface PostData {
  postId: string;
  userid: string;
  createdAt: string;
  imageUrl?: Record<string, string | undefined>;
  captions?: { captionId?: string; content?: string };
  hashtags: string[];
  mentions: MentionRef[];
  visibility: "public" | "friends" | "private";
  archived: boolean;
  settings: PostSettings;
  likeCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
  liked: boolean;
  saved: boolean;
  isOwner: boolean;
  author: PostPerson;
  comments?: PostComment[];
}

interface ApiResult<T> {
  success: boolean;
  message?: string;
  data: T;
}

// --------------------------------------------------
// Request helper
// --------------------------------------------------

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");

  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const result: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : `Request failed (${response.status})`;

    throw new Error(message);
  }

  return result as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

const postPath = (ownerId: string, postId: string) =>
  `/api/posts/${encodeURIComponent(ownerId)}/${encodeURIComponent(postId)}`;

// --------------------------------------------------
// Feed and single post
// --------------------------------------------------

export async function getFeed(): Promise<{
  posts: PostData[];
  viewer: PostPerson;
}> {
  const result = await request<
    ApiResult<{ posts: PostData[]; total: number; viewer: PostPerson }>
  >("/api/feed");

  return { posts: result.data.posts ?? [], viewer: result.data.viewer };
}

export async function getPost(
  ownerId: string,
  postId: string,
): Promise<{ post: PostData; viewer: PostPerson }> {
  const result = await request<ApiResult<{ post: PostData; viewer: PostPerson }>>(
    postPath(ownerId, postId),
  );

  return result.data;
}

// --------------------------------------------------
// Likes, saves, shares
// --------------------------------------------------

export async function setLike(ownerId: string, postId: string, liked: boolean) {
  const result = await request<ApiResult<{ liked: boolean; likeCount: number }>>(
    `${postPath(ownerId, postId)}/like`,
    json({ liked }),
  );

  return result.data;
}

export async function setSave(ownerId: string, postId: string, saved: boolean) {
  const result = await request<ApiResult<{ saved: boolean; saveCount: number }>>(
    `${postPath(ownerId, postId)}/save`,
    json({ saved }),
  );

  return result.data;
}

export async function sharePost(
  ownerId: string,
  postId: string,
  toUserIds: string[],
  text: string,
) {
  const result = await request<ApiResult<{ sent: number; shareCount: number }>>(
    `${postPath(ownerId, postId)}/share`,
    json({ toUserIds, text }),
  );

  return result.data;
}

// --------------------------------------------------
// Comments
// --------------------------------------------------

export async function addComment(
  ownerId: string,
  postId: string,
  commentText: string,
  parentCommentId: string | null,
) {
  const result = await request<
    ApiResult<{ comment: PostComment; commentCount: number }>
  >(`${postPath(ownerId, postId)}/comments`, json({ commentText, parentCommentId }));

  return result.data;
}

export async function editComment(
  ownerId: string,
  postId: string,
  commentId: string,
  commentText: string,
) {
  const result = await request<
    ApiResult<{ commentText: string; mentions: MentionRef[]; updatedAt: string }>
  >(`${postPath(ownerId, postId)}/comments/${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    body: JSON.stringify({ commentText }),
  });

  return result.data;
}

export async function deleteComment(
  ownerId: string,
  postId: string,
  commentId: string,
) {
  const result = await request<ApiResult<{ commentCount: number }>>(
    `${postPath(ownerId, postId)}/comments/${encodeURIComponent(commentId)}`,
    { method: "DELETE" },
  );

  return result.data;
}

export async function setCommentLike(
  ownerId: string,
  postId: string,
  commentId: string,
  liked: boolean,
) {
  const result = await request<ApiResult<{ liked: boolean; likeCount: number }>>(
    `${postPath(ownerId, postId)}/comments/${encodeURIComponent(commentId)}/like`,
    json({ liked }),
  );

  return result.data;
}

// --------------------------------------------------
// Owner actions and reports
// --------------------------------------------------

export interface PostEdits {
  caption?: string;
  hashtags?: string[];
  settings?: Partial<PostSettings>;
}

export async function updatePost(
  ownerId: string,
  postId: string,
  edits: PostEdits,
) {
  const result = await request<
    ApiResult<{
      captions: { captionId?: string; content?: string };
      hashtags: string[];
      mentions: MentionRef[];
      settings: PostSettings;
    }>
  >(postPath(ownerId, postId), {
    method: "PATCH",
    body: JSON.stringify(edits),
  });

  return result.data;
}

export async function archivePost(
  ownerId: string,
  postId: string,
  archived: boolean,
) {
  await request<ApiResult<{ archived: boolean }>>(
    `${postPath(ownerId, postId)}/archive`,
    json({ archived }),
  );
}

export async function deletePost(ownerId: string, postId: string) {
  await request<{ success: boolean }>(postPath(ownerId, postId), {
    method: "DELETE",
  });
}

export async function reportPost(
  ownerId: string,
  postId: string,
  reason: string,
) {
  await request<{ success: boolean }>(
    `${postPath(ownerId, postId)}/report`,
    json({ reason }),
  );
}

// --------------------------------------------------
// Friends (share sheet and @mention suggestions) and messages
// --------------------------------------------------

let friendsPromise: Promise<PostPerson[]> | null = null;

/** Loaded once and reused, so typing "@" never calls the API repeatedly. */
export function loadFriends(force = false): Promise<PostPerson[]> {
  if (!friendsPromise || force) {
    friendsPromise = request<ApiResult<{ friends: PostPerson[] }>>(
      "/api/posts/friends",
    )
      .then((result) => result.data.friends ?? [])
      .catch((error: unknown) => {
        friendsPromise = null;
        throw error;
      });
  }

  return friendsPromise;
}

export async function sendMessage(input: {
  recipientUserId: string;
  text: string;
  sharedPostId?: string;
  sharedPostOwnerId?: string;
}) {
  await request<{ success: boolean }>("/api/messages/send", json(input));
}
