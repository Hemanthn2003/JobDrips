
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useNavigate,
  useParams,
} from "react-router-dom";

import { profileService } from "../../services/profileService";

import type {
  Friend,
  Profile as ProfileData,
  ProfileUpdateData,
} from "../../services/profileService";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

type Tab = "posts" | "mentions" | "saved";
type ImageKind = "profile" | "cover" | "story";

const formatDate = (value?: string): string => {
  if (!value) return "Not available";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });
};

const Profile = () => {
  const { userid } = useParams<{ userid: string }>();
  const navigate = useNavigate();

  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [ownName, setOwnName] = useState("");
  const [ownEmail, setOwnEmail] = useState("");
  const [ownPhoto, setOwnPhoto] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingStory, setUploadingStory] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [editorOpen, setEditorOpen] = useState(false);

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  const ownProfile = !userid;

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (userid) {
        const response =
          await profileService.getPublicProfile(userid);

        setProfile(response.data);
        setOwnName("");
        setOwnEmail("");
        setOwnPhoto("");
      } else {
        const response = await profileService.getMyProfile();
        const result = response.data;

        setProfile(result.profile);
        setOwnName(result.user.name || "");
        setOwnEmail(result.user.email || "");
        setOwnPhoto(result.user.profilePhoto || "");
      }
    } catch (err: unknown) {
      const text =
        err instanceof Error
          ? err.message
          : "Unable to load profile.";

      if (
        text.toLowerCase().includes("unauthorized") ||
        text.toLowerCase().includes("authentication")
      ) {
        navigate("/", { replace: true });
        return;
      }

      setError(text);
    } finally {
      setLoading(false);
    }
  }, [userid, navigate]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const openEditor = () => {
    if (!profile) return;

    setUsername(profile.username || "");
    setBio(profile.bio || "");
    setIsPrivate(Boolean(profile.isPrivate));
    setEditorOpen(true);
    setError("");
    setNotice("");
  };

  const saveDetails = async () => {
    setSaving(true);
    setError("");
    setNotice("");

    try {
      const changes: ProfileUpdateData = {
        username: username.trim(),
        bio: bio.trim(),
        isPrivate,
      };

      const response =
        await profileService.updateMyProfile(changes);

      setProfile(response.data.profile);
      setOwnName(response.data.user.name || "");
      setOwnPhoto(response.data.user.profilePhoto || "");
      setEditorOpen(false);
      setNotice("Your profile details have been saved.");
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  const uploadAndSaveImage = async (
    file: File,
    kind: ImageKind,
  ) => {
    setError("");
    setNotice("");

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setError("Images must be 5 MB or smaller.");
      return;
    }

    const setUploading = {
      profile: setUploadingProfile,
      cover: setUploadingCover,
      story: setUploadingStory,
    }[kind];

    setUploading(true);

    try {
      const upload = await profileService.uploadImage(file);
      const imageUrl = upload.data.secureUrl;

      if (kind === "story") {
        setNotice(
          "Image uploaded to Cloudinary. Publishing stories requires a story API, which is not yet connected.",
        );
        return;
      }

      if (kind === "profile") {
        await profileService.updateProfileImage({
          profileimage: imageUrl,
        });
      } else {
        await profileService.updateMyProfile({
          coverimage: imageUrl,
        });
      }

      await loadProfile();

      setNotice(
        kind === "profile"
          ? "Profile photo uploaded and saved."
          : "Cover photo uploaded and saved.",
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Image upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[65vh] items-center justify-center bg-[#FBF6F1]">
        <div className="rounded-3xl border border-[#EBDCD1] bg-white px-8 py-7 text-center shadow-sm">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-[#F0DED2] border-t-[#A4543A]" />
          <p className="mt-3 text-sm font-semibold text-[#846B5F]">
            Preparing your profile...
          </p>
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="mx-auto max-w-lg px-5 py-16 text-center">
        <h1 className="text-xl font-black text-[#33251F]">
          Profile unavailable
        </h1>
        <p className="mt-3 text-sm text-[#846B5F]">
          {error || "We couldn't find this profile."}
        </p>
        <button
          type="button"
          onClick={() => void loadProfile()}
          className="mt-5 rounded-full bg-[#A4543A] px-6 py-3 font-bold text-white"
        >
          Try again
        </button>
      </main>
    );
  }

  const displayName =
    ownName || profile.username || "JobDrips member";

  const avatar = profile.profileimage || ownPhoto;

  const friends: Friend[] = (profile.friends || []).filter(
    (friend: Friend) => friend.friendshipAccepted,
  );

  const posts = profile.posts || [];
  const mentions = profile.mentionedPosts || [];
  const saved = profile.savedPosts || [];

  const restricted =
    !ownProfile &&
    Boolean(profile.isPrivate) &&
    Boolean(profile.postAccessRestricted);

  const complete = Boolean(
    profile.bio?.trim() &&
      avatar &&
      ((profile.education?.school?.length || 0) +
        (profile.education?.college?.length || 0) +
        (profile.experience?.length || 0) >
        0),
  );

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "posts", label: "Posts", count: posts.length },
    { id: "mentions", label: "Mentions", count: mentions.length },
    { id: "saved", label: "Saved", count: saved.length },
  ];

  return (
    <main className="min-h-screen bg-[#FBF6F1] pb-8 text-[#30231E]">
      <div className="mx-auto max-w-5xl sm:px-5 sm:pt-5">
        <section className="overflow-hidden bg-white shadow-[0_8px_32px_rgba(103,62,42,0.07)] sm:rounded-[30px] sm:border sm:border-[#EBDCD1]">
          {/* Cover image */}
          <div className="group relative h-36 overflow-hidden bg-gradient-to-br from-[#F3DCCE] via-[#D5AB94] to-[#8F5844] sm:h-60">
            {profile.coverimage && (
              <img
                src={profile.coverimage}
                alt="Profile cover"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-[#38241C]/25 via-transparent to-black/5" />

            {ownProfile && (
              <>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadAndSaveImage(file, "cover");
                    }
                    event.target.value = "";
                  }}
                />

                <button
                  type="button"
                  disabled={uploadingCover}
                  onClick={() => coverInputRef.current?.click()}
                  className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-white/60 bg-white/90 px-4 py-2.5 text-xs font-extrabold text-[#71432F] shadow-lg backdrop-blur transition hover:bg-white disabled:opacity-60"
                >
                  {uploadingCover ? (
                    <span className="animate-pulse">
                      Uploading...
                    </span>
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-4 w-4"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="3" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                      Change cover
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          {/* White profile container */}
          <div className="relative rounded-t-[28px] bg-white px-5 pb-5 sm:-mt-7 sm:rounded-t-[34px] sm:px-9 sm:pb-7">
            {ownProfile && (
              <button
                type="button"
                onClick={openEditor}
                aria-label="Edit profile details"
                title="Edit profile"
                className="absolute right-5 top-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E9D2C3] bg-[#FFF8F3] text-[#985438] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#F8E9DF] sm:right-8 sm:top-5"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z" />
                </svg>
              </button>
            )}

            <div className="flex flex-col items-center sm:flex-row sm:items-end sm:gap-6">
              <div className="relative -mt-12 h-28 w-28 shrink-0 rounded-[27px] border-[5px] border-white bg-[#F2DFD3] p-0.5 shadow-[0_7px_20px_rgba(87,51,35,0.18)] sm:-mt-16 sm:h-36 sm:w-36">
                <div className="h-full w-full overflow-hidden rounded-[20px]">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={displayName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F4E4D9] to-[#D8AE96] text-4xl font-black text-[#985438]">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {ownProfile && (
                  <>
                    <input
                      ref={profileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadAndSaveImage(file, "profile");
                        }
                        event.target.value = "";
                      }}
                    />

                    <button
                      type="button"
                      aria-label="Change profile photo"
                      title="Change profile photo"
                      disabled={uploadingProfile}
                      onClick={() => profileInputRef.current?.click()}
                      className="absolute -bottom-2 -right-2 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-gradient-to-br from-[#CE8D6D] to-[#994D35] text-white shadow-md transition hover:scale-105 disabled:opacity-60"
                    >
                      {uploadingProfile ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          className="h-5 w-5"
                        >
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                    </button>
                  </>
                )}
              </div>

              <div className="mt-4 min-w-0 flex-1 text-center sm:mb-2 sm:mt-0 sm:text-left">
                <h1 className="break-words text-2xl font-black tracking-tight text-[#30231E] sm:text-3xl">
                  {displayName}
                </h1>
                <p className="mt-1 text-sm font-semibold text-[#A9684E]">
                  @{profile.username}
                </p>

                {ownProfile && (
                  <p className="mt-1 text-xs text-[#9B8174]">
                    {ownEmail}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#68564D] sm:text-base">
                {profile.bio || "Add a bio to tell people about yourself."}
              </p>

              {profile.experience?.[0] && (
                <p className="flex items-center gap-3 text-sm text-[#68564D]">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="h-5 w-5 shrink-0 text-[#B45E40]"
                  >
                    <rect x="3" y="7" width="18" height="14" rx="2" />
                    <path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2" />
                  </svg>
                  <span>
                    {profile.experience[0].role}
                    {profile.experience[0].company
                      ? ` at ${profile.experience[0].company}`
                      : ""}
                  </span>
                </p>
              )}

              <p className="flex items-center gap-3 text-sm text-[#68564D]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5 shrink-0 text-[#B45E40]"
                >
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 10h18" />
                </svg>
                Joined {formatDate(profile.createdAt)}
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-[#EFE0D6] bg-[#FFFBF8]">
              <button
                type="button"
                onClick={() => {
                  setNotice(
                    friends.length
                      ? `${friends.length} accepted friends are listed below.`
                      : "You haven't added any friends yet.",
                  );
                }}
                className="border-r border-[#EFE0D6] p-4 text-left transition hover:bg-[#FFF3EB]"
              >
                <div className="flex items-center gap-2">
                  <div className="flex shrink-0 items-center">
                    {friends.slice(0, 3).map(
                      (friend: Friend, index: number) => (
                        <span
                          key={friend.userid}
                          style={{
                            marginLeft: index === 0 ? 0 : -9,
                            zIndex: 3 - index,
                          }}
                          className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#FFFBF8] bg-[#E8C6B2] text-[10px] font-black text-[#814832]"
                        >
                          {friend.username.charAt(0).toUpperCase()}
                        </span>
                      ),
                    )}
                  </div>

                  <span className="text-xl font-black text-[#30231E]">
                    {friends.length}
                  </span>

                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="ml-auto h-4 w-4 text-[#A9684E]"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>

                <p className="mt-2 text-xs font-semibold text-[#80695D]">
                  Friends
                </p>
              </button>

              <div className="p-4">
                <p className="text-xl font-black text-[#30231E]">
                  {posts.length}
                </p>
                <p className="mt-2 text-xs font-semibold text-[#80695D]">
                  Posts
                </p>
              </div>
            </div>

            {ownProfile && (
              <div className="mt-5 flex items-center justify-between border-t border-[#EFE0D6] pt-4">
                <div>
                  <p className="text-sm font-extrabold text-[#30231E]">
                    Your story
                  </p>
                  <p className="mt-1 text-xs text-[#927A6E]">
                    Share a moment with your friends
                  </p>
                </div>

                <input
                  ref={storyInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void uploadAndSaveImage(file, "story");
                    }
                    event.target.value = "";
                  }}
                />

                <button
                  type="button"
                  disabled={uploadingStory}
                  onClick={() => storyInputRef.current?.click()}
                  aria-label="Create story"
                  title="Create story"
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#D39472] to-[#994D35] text-white shadow-md transition hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-60"
                >
                  {uploadingStory ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-6 w-6"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>
        </section>

        {(error || notice) && (
          <div
            role="status"
            className="mx-3 mt-4 rounded-2xl border border-[#EBD7C8] bg-white p-4 text-sm text-[#80533E] sm:mx-0"
          >
            {error || notice}
          </div>
        )}

        <section className="mt-4 overflow-hidden border-y border-[#EBDCD1] bg-white sm:rounded-2xl sm:border">
          <div className="grid grid-cols-3">
            {tabs.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`border-b-[3px] py-4 text-sm font-extrabold transition ${
                  activeTab === tab.id
                    ? "border-[#A4543A] bg-[#FFFBF8] text-[#A4543A]"
                    : "border-transparent text-[#8D776B] hover:bg-[#FFFAF6]"
                }`}
              >
                {tab.label}
                <span className="ml-1 text-xs opacity-70">
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {restricted ? (
            <div className="px-5 py-12 text-center sm:py-16">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F8E9E3] text-[#A4543A]">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-8 w-8"
                >
                  <rect x="4" y="10" width="16" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </div>

              <h2 className="mt-5 text-xl font-black text-[#30231E]">
                This profile is private
              </h2>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#80695D]">
                Send a connection request to view their posts, photos and more.
              </p>

              <button
                type="button"
                disabled
                title="Connection request API needs to be connected"
                className="mt-6 w-full max-w-sm rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-6 py-3.5 font-bold text-white opacity-80"
              >
                Send connection request
              </button>
            </div>
          ) : (
            <PostGrid
              items={
                activeTab === "posts"
                  ? posts
                  : activeTab === "mentions"
                    ? mentions
                    : ownProfile
                      ? saved
                      : []
              }
              emptyTitle={
                activeTab === "posts"
                  ? "Your story starts here"
                  : activeTab === "mentions"
                    ? "No mentions yet"
                    : "Nothing saved yet"
              }
              emptyText={
                activeTab === "posts"
                  ? "Your profile posts will appear here."
                  : activeTab === "mentions"
                    ? "Posts mentioning this user will appear here."
                    : "Your saved posts will appear here."
              }
            />
          )}
        </section>

        {editorOpen && ownProfile && (
          <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-[#2D1D16]/55 p-0 backdrop-blur-sm sm:items-center sm:p-5"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setEditorOpen(false);
              }
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-profile-title"
              className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-[30px] border border-[#EBDCD1] bg-[#FFFCF9] p-5 shadow-2xl sm:rounded-[30px] sm:p-8"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-[#A9684E]">
                    JobDrips
                  </p>
                  <h2
                    id="edit-profile-title"
                    className="mt-2 text-2xl font-black text-[#30231E]"
                  >
                    {complete
                      ? "Edit your profile"
                      : "Complete your profile"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-[#80695D]">
                    Keep your professional identity current.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  aria-label="Close"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F4E7DE] text-xl text-[#80533E]"
                >
                  ×
                </button>
              </div>

              <div className="mt-6 space-y-4">
                <label className="block text-sm font-bold text-[#463229]">
                  Username
                  <input
                    value={username}
                    onChange={(event) =>
                      setUsername(event.target.value)
                    }
                    minLength={3}
                    maxLength={30}
                    className="mt-2 h-12 w-full rounded-xl border border-[#E6D5C9] bg-white px-4 font-normal outline-none transition focus:border-[#B87556] focus:ring-2 focus:ring-[#B87556]/15"
                    placeholder="your.username"
                  />
                </label>

                <label className="block text-sm font-bold text-[#463229]">
                  About you
                  <textarea
                    value={bio}
                    onChange={(event) => setBio(event.target.value)}
                    rows={4}
                    maxLength={500}
                    className="mt-2 w-full resize-y rounded-xl border border-[#E6D5C9] bg-white p-4 font-normal outline-none transition focus:border-[#B87556] focus:ring-2 focus:ring-[#B87556]/15"
                    placeholder="Your role, skills and interests..."
                  />
                  <span className="mt-1 block text-right text-xs font-normal text-[#9B8174]">
                    {bio.length}/500
                  </span>
                </label>

                <label className="flex items-center gap-3 rounded-xl border border-[#E6D5C9] bg-white p-4">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(event) =>
                      setIsPrivate(event.target.checked)
                    }
                    className="h-4 w-4 accent-[#A4543A]"
                  />
                  <span>
                    <span className="block text-sm font-bold text-[#463229]">
                      Private profile
                    </span>
                    <span className="mt-1 block text-xs font-normal leading-5 text-[#80695D]">
                      Restrict profile content from non-friends.
                    </span>
                  </span>
                </label>
              </div>

              {error && (
                <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              )}

              <button
                type="button"
                disabled={saving}
                onClick={() => void saveDetails()}
                className="mt-6 w-full rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-6 py-3.5 font-extrabold text-white shadow-md transition hover:brightness-95 disabled:opacity-60"
              >
                {saving ? "Saving changes..." : "Save profile"}
              </button>
            </section>
          </div>
        )}
      </div>
    </main>
  );
};

function PostGrid({
  items,
  emptyTitle,
  emptyText,
}: {
  items: unknown[];
  emptyTitle: string;
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-12 text-center sm:py-16">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F8EEE8] text-[#A4543A]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-7 w-7"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M8 12h8M12 8v8" />
          </svg>
        </div>

        <h3 className="mt-4 font-extrabold text-[#30231E]">
          {emptyTitle}
        </h3>
        <p className="mt-2 text-sm text-[#80695D]">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1 p-1 sm:gap-2 sm:p-3">
      {items.map((item: unknown, index: number) => {
        if (!item || typeof item !== "object") return null;

        const post = item as Record<string, unknown>;
        const imageObject = post.imageUrl as
          | Record<string, unknown>
          | undefined;

        const images = Array.isArray(post.imageUrls)
          ? post.imageUrls.filter(
              (value): value is string =>
                typeof value === "string" && Boolean(value),
            )
          : imageObject
            ? Object.values(imageObject).filter(
                (value): value is string =>
                  typeof value === "string" && Boolean(value),
              )
            : [];

        const captionObject = post.captions as
          | Record<string, unknown>
          | undefined;

        const caption =
          (typeof post.caption === "string" && post.caption) ||
          (typeof captionObject?.content === "string" &&
            captionObject.content) ||
          "";

        return (
          <button
            type="button"
            key={
              typeof post.postId === "string"
                ? post.postId
                : index
            }
            title={caption || "Profile post"}
            onClick={() => {
              // Post detail navigation will be connected with the
              // shared post-detail component and backend endpoints.
            }}
            className="group relative aspect-square overflow-hidden rounded-md bg-[#F0DFD3] text-left sm:rounded-xl"
          >
            {images[0] ? (
              <img
                src={images[0]}
                alt={caption || "Post"}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-3 text-center text-xs leading-5 text-[#80533E]">
                {caption || "Post"}
              </div>
            )}

            {images.length > 1 && (
              <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-3.5 w-3.5"
                >
                  <rect x="8" y="8" width="13" height="13" rx="2" />
                  <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                </svg>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default Profile;
