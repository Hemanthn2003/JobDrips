import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { profileService } from "../../services/profileService";
import { MessageSheet } from "../../components/post/PostSheets";
import type {
  Education,
  EducationInput,
  Experience,
  ExperienceInput,
  Friend,
  Profile as ProfileData,
  ProfileUpdateData,
  Relationship,
  Story,
} from "../../services/profileService";

// --------------------------------------------------
// Constants and small helpers
// --------------------------------------------------

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const STORY_DURATION_MS = 5000;
const RING_LOADING_MS = 1500;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

type Tab = "posts" | "mentions" | "saved";
type ImageKind = "profile" | "cover" | "story";

type UsernameState =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "error";

const ICONS = {
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  calendar: "M3 6h18v15H3Z M16 3v4 M8 3v4 M3 10h18",
  briefcase: "M3 8h18v12H3Z M8 8V5h8v3 M3 13h18",
  chevron: "m9 6 6 6-6 6",
  pencil: "M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z",
  plus: "M12 5v14 M5 12h14",
  heart:
    "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  bookmark: "M6 4h12v17l-6-4-6 4Z",
  comment: "M4 5h16v11H9l-5 4Z",
  lock: "M4 10h16v11H4Z M8 10V7a4 4 0 0 1 8 0v3",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
} as const;

const inputClass =
  "mt-1.5 h-11 w-full rounded-xl border border-[#E6D5C9] bg-white px-3.5 text-sm font-normal text-[#463229] outline-none focus:border-[#B87556] focus:ring-2 focus:ring-[#B87556]/15";
const smallButtonClass =
  "rounded-full border border-[#D9B7A5] px-3 py-2 text-xs font-bold text-[#985438] disabled:opacity-60";
const primaryButtonClass =
  "rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-5 py-2.5 text-sm font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60";

const actionPillClass =
  "rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-4 py-2 text-xs font-extrabold text-white shadow-sm disabled:opacity-60";
const mutedPillClass =
  "rounded-full border border-[#E0CFC4] bg-[#FFF8F3] px-4 py-2 text-xs font-bold text-[#8D776B]";

const errMsg = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isStoryActive = (story: Story): boolean =>
  new Date(story.expiresAt).getTime() > Date.now();

const formatDate = (value?: string): string => {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

const timeAgo = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";

  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return formatDate(value);
};

const websiteHref = (value: string): string =>
  /^https?:\/\//i.test(value) ? value : `https://${value}`;

const websiteLabel = (value: string): string =>
  value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const preloadImage = (src: string) =>
  new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Unable to load this story image."));
    image.src = src;
  });

type IncomingRequest = {
  userid?: string;
  accept?: boolean;
  username?: string;
  profileimage?: string;
  name?: string;
  profile?: {
    userid?: string;
    username?: string;
    profileimage?: string;
    name?: string;
  };
};

const requestIdentity = (request: IncomingRequest, index: number) => ({
  key: request.profile?.userid || request.userid || `request-${index}`,
  name:
    request.profile?.username ||
    request.username ||
    request.name ||
    "JobDrips member",
  photo: request.profile?.profileimage || request.profileimage || "",
});

// --------------------------------------------------
// Small presentational components
// --------------------------------------------------

function Icon({
  d,
  className = "h-5 w-5",
}: {
  d: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function VerifiedBadge() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0"
      role="img"
      aria-label="Verified"
    >
      <circle cx="12" cy="12" r="11" fill="#A4543A" />
      <path
        d="m7.5 12.5 3 3 6-6.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Avatar({
  src,
  name,
  className = "h-10 w-10",
  square = false,
}: {
  src?: string;
  name: string;
  className?: string;
  square?: boolean;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-[#E8C6B2] font-black text-[#814832] ${
        square ? "rounded-xl" : "rounded-full"
      } ${className}`}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        (name.charAt(0) || "?").toUpperCase()
      )}
    </span>
  );
}

function AvatarStack({
  items,
}: {
  items: { src?: string; name: string }[];
}) {
  // Display only: clicks pass through to the button that wraps it.
  return (
    <span className="pointer-events-none flex items-center">
      {items.slice(0, 3).map((item, index) => (
        <span
          key={`${item.name}-${index}`}
          style={{ marginLeft: index === 0 ? 0 : -8, zIndex: 3 - index }}
          className="relative"
        >
          <Avatar
            src={item.src}
            name={item.name}
            className="h-6 w-6 border-2 border-white text-[9px] sm:h-7 sm:w-7 sm:text-[10px]"
          />
        </span>
      ))}
    </span>
  );
}

function Sheet({
  title,
  subtitle,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-[#2D1D16]/55 p-0 backdrop-blur-sm sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-t-[30px] border border-[#EBDCD1] bg-[#FFFCF9] p-5 shadow-2xl sm:rounded-[30px] sm:p-7 ${
          wide ? "max-w-xl" : "max-w-lg"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-[#30231E]">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-sm text-[#80695D]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F4E7DE] text-2xl text-[#80533E]"
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

// --------------------------------------------------
// Education editor (works inside the edit modal)
// --------------------------------------------------

const emptyEducationForm = {
  type: "college" as "school" | "college",
  name: "",
  board: "",
  degree: "",
  field: "",
  startYear: "",
  endYear: "",
};

function EducationEditor({
  education,
  onChange,
  onError,
}: {
  education: Education;
  onChange: (education: Education) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [form, setForm] = useState(emptyEducationForm);

  const setField = (key: keyof typeof emptyEducationForm, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const years = (start: number, end: number | null) =>
    `${start} – ${end ?? "Present"}`;

  const entries = [
    ...education.school.map((item) => ({
      id: item.schoolId,
      title: item.name,
      subtitle: [item.board, years(item.startYear, item.endYear)]
        .filter(Boolean)
        .join(" · "),
    })),
    ...education.college.map((item) => ({
      id: item.collegeId,
      title: item.name,
      subtitle: [item.degree, item.field, years(item.startYear, item.endYear)]
        .filter(Boolean)
        .join(" · "),
    })),
  ];

  const submit = async () => {
    const startYear = Number(form.startYear);
    const endYear = form.endYear ? Number(form.endYear) : null;

    if (!form.name.trim() || !Number.isInteger(startYear)) {
      onError("Enter the institution name and a valid start year.");
      return;
    }

    const payload: EducationInput = {
      type: form.type,
      name: form.name.trim(),
      startYear,
      endYear,
      board: form.board.trim(),
      degree: form.degree.trim(),
      field: form.field.trim(),
    };

    setBusy(true);

    try {
      const response = await profileService.addEducation(payload);
      onChange(response.data);
      setForm(emptyEducationForm);
      setAdding(false);
    } catch (err: unknown) {
      onError(errMsg(err, "Unable to add education."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemovingId(id);

    try {
      const response = await profileService.deleteEducation(id);
      onChange(response.data);
    } catch (err: unknown) {
      onError(errMsg(err, "Unable to remove education."));
    } finally {
      setRemovingId("");
    }
  };

  return (
    <div className="rounded-2xl border border-[#E6D5C9] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#463229]">Education</p>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className={smallButtonClass}
        >
          {adding ? "Cancel" : "Add education"}
        </button>
      </div>

      {entries.length === 0 && !adding && (
        <p className="mt-2 text-xs text-[#80695D]">No education added yet.</p>
      )}

      {entries.length > 0 && (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-[#FFF8F3] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#30231E]">
                  {entry.title}
                </p>
                <p className="text-xs text-[#80695D]">{entry.subtitle}</p>
              </div>
              <button
                type="button"
                disabled={removingId === entry.id}
                onClick={() => void remove(entry.id)}
                aria-label={`Remove ${entry.title}`}
                className="text-xs font-bold text-red-600 disabled:opacity-50"
              >
                {removingId === entry.id ? "Removing..." : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-bold text-[#463229]">
            Type
            <select
              value={form.type}
              onChange={(event) => setField("type", event.target.value)}
              className={inputClass}
            >
              <option value="college">College / University</option>
              <option value="school">School</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-[#463229]">
            Institution
            <input
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
              className={inputClass}
              placeholder="Institution name"
            />
          </label>
          {form.type === "school" ? (
            <label className="block text-xs font-bold text-[#463229]">
              Board
              <input
                value={form.board}
                onChange={(event) => setField("board", event.target.value)}
                className={inputClass}
                placeholder="e.g. State board"
              />
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-bold text-[#463229]">
                Degree
                <input
                  value={form.degree}
                  onChange={(event) => setField("degree", event.target.value)}
                  className={inputClass}
                  placeholder="B.E."
                />
              </label>
              <label className="block text-xs font-bold text-[#463229]">
                Field of study
                <input
                  value={form.field}
                  onChange={(event) => setField("field", event.target.value)}
                  className={inputClass}
                  placeholder="Electronics"
                />
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-[#463229]">
              Start year
              <input
                type="number"
                inputMode="numeric"
                value={form.startYear}
                onChange={(event) => setField("startYear", event.target.value)}
                className={inputClass}
                placeholder="2021"
              />
            </label>
            <label className="block text-xs font-bold text-[#463229]">
              End year (blank if ongoing)
              <input
                type="number"
                inputMode="numeric"
                value={form.endYear}
                onChange={(event) => setField("endYear", event.target.value)}
                className={inputClass}
                placeholder="2025"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className={primaryButtonClass}
          >
            {busy ? "Adding..." : "Save education"}
          </button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------
// Experience editor (works inside the edit modal)
// --------------------------------------------------

const emptyExperienceForm = {
  role: "",
  company: "",
  employmentType: "Full-time",
  location: "",
  startDate: "",
  endDate: "",
  description: "",
};

function ExperienceEditor({
  experience,
  onChange,
  onError,
}: {
  experience: Experience[];
  onChange: (experience: Experience[]) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [form, setForm] = useState(emptyExperienceForm);

  const setField = (key: keyof typeof emptyExperienceForm, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = async () => {
    if (!form.role.trim() || !form.startDate.trim()) {
      onError("Enter your role and a start date.");
      return;
    }

    const payload: ExperienceInput = {
      role: form.role.trim(),
      company: form.company.trim(),
      employmentType: form.employmentType,
      location: form.location.trim(),
      startDate: form.startDate,
      endDate: form.endDate,
      description: form.description.trim(),
    };

    setBusy(true);

    try {
      const response = await profileService.addExperience(payload);
      onChange(response.data);
      setForm(emptyExperienceForm);
      setAdding(false);
    } catch (err: unknown) {
      onError(errMsg(err, "Unable to add experience."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemovingId(id);

    try {
      const response = await profileService.deleteExperience(id);
      onChange(response.data);
    } catch (err: unknown) {
      onError(errMsg(err, "Unable to remove experience."));
    } finally {
      setRemovingId("");
    }
  };

  return (
    <div className="rounded-2xl border border-[#E6D5C9] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-[#463229]">Experience</p>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className={smallButtonClass}
        >
          {adding ? "Cancel" : "Add experience"}
        </button>
      </div>

      {experience.length === 0 && !adding && (
        <p className="mt-2 text-xs text-[#80695D]">No experience added yet.</p>
      )}

      {experience.length > 0 && (
        <ul className="mt-3 space-y-2">
          {experience.map((item) => (
            <li
              key={item.experienceId}
              className="flex items-start justify-between gap-3 rounded-xl bg-[#FFF8F3] p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#30231E]">
                  {item.role}
                  {item.company ? ` at ${item.company}` : ""}
                </p>
                <p className="text-xs text-[#80695D]">
                  {[
                    item.employmentType,
                    `${item.startDate} – ${item.endDate || "Present"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                disabled={removingId === item.experienceId}
                onClick={() => void remove(item.experienceId)}
                aria-label={`Remove ${item.role}`}
                className="text-xs font-bold text-red-600 disabled:opacity-50"
              >
                {removingId === item.experienceId ? "Removing..." : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-[#463229]">
              Role
              <input
                value={form.role}
                onChange={(event) => setField("role", event.target.value)}
                className={inputClass}
                placeholder="Software Developer"
              />
            </label>
            <label className="block text-xs font-bold text-[#463229]">
              Company
              <input
                value={form.company}
                onChange={(event) => setField("company", event.target.value)}
                className={inputClass}
                placeholder="Company name"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-[#463229]">
              Employment type
              <select
                value={form.employmentType}
                onChange={(event) =>
                  setField("employmentType", event.target.value)
                }
                className={inputClass}
              >
                {["Full-time", "Part-time", "Internship", "Freelance", "Contract"].map(
                  (type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="block text-xs font-bold text-[#463229]">
              Location
              <input
                value={form.location}
                onChange={(event) => setField("location", event.target.value)}
                className={inputClass}
                placeholder="Bengaluru"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-[#463229]">
              Start date
              <input
                type="month"
                value={form.startDate}
                onChange={(event) => setField("startDate", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-xs font-bold text-[#463229]">
              End date (blank if current)
              <input
                type="month"
                value={form.endDate}
                onChange={(event) => setField("endDate", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="block text-xs font-bold text-[#463229]">
            Description
            <textarea
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              rows={3}
              className="mt-1.5 w-full resize-y rounded-xl border border-[#E6D5C9] bg-white p-3.5 text-sm font-normal outline-none focus:border-[#B87556] focus:ring-2 focus:ring-[#B87556]/15"
              placeholder="What did you work on?"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className={primaryButtonClass}
          >
            {busy ? "Adding..." : "Save experience"}
          </button>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------
// Posts (image grid)
// --------------------------------------------------

function PostGrid({
  items,
  emptyTitle,
  emptyText,
  onOpen,
}: {
  items: unknown[];
  emptyTitle: string;
  emptyText: string;
  onOpen: (item: unknown) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="px-5 py-12 text-center sm:py-16">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F8EEE8] text-[#A4543A]">
          <Icon d={ICONS.plus} className="h-7 w-7" />
        </div>
        <h3 className="mt-4 font-extrabold text-[#30231E]">{emptyTitle}</h3>
        <p className="mt-2 text-sm text-[#80695D]">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-0.5 p-0.5 sm:gap-1 sm:p-1">
      {items.map((item, index) => {
        if (!item || typeof item !== "object") return null;

        const record = item as Record<string, unknown>;
        const imageMap = record.imageUrl;

        const images: string[] = Array.isArray(record.imageUrls)
          ? record.imageUrls.filter(isNonEmptyString)
          : imageMap && typeof imageMap === "object"
            ? Object.values(imageMap as Record<string, unknown>).filter(
                isNonEmptyString,
              )
            : [];

        const captions = record.captions as Record<string, unknown> | undefined;
        const caption =
          typeof record.caption === "string"
            ? record.caption
            : typeof captions?.content === "string"
              ? captions.content
              : "";

        const id =
          typeof record.postId === "string" ? record.postId : `post-${index}`;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(item)}
            aria-label={caption ? `Open post: ${caption.slice(0, 40)}` : "Open post"}
            className="group relative aspect-square overflow-hidden bg-[#F0DFD3]"
          >
            {images[0] ? (
              <img
                src={images[0]}
                alt={caption || "Post"}
                loading="lazy"
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            ) : (
              <span className="flex h-full items-center justify-center p-3 text-center text-xs leading-5 text-[#80533E]">
                {caption || "Post"}
              </span>
            )}
            {images.length > 1 && (
              <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                +{images.length - 1}
              </span>
            )}
            {record.archived === true && (
              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                Archived
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------
// Profile page
// --------------------------------------------------

const Profile = () => {
  const { userid } = useParams<{ userid: string }>();
  const navigate = useNavigate();
  // True when this page shows the signed-in person's own profile.
  const [selfView, setSelfView] = useState(false);
  const ownProfile = !userid || selfView;

  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const storyInputRef = useRef<HTMLInputElement>(null);
  const reportedViews = useRef<Set<string>>(new Set());

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [ownName, setOwnName] = useState("");
  const [ownEmail, setOwnEmail] = useState("");
  const [ownPhoto, setOwnPhoto] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("posts");
  const [, setClock] = useState(0);

  // Edit modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [locationText, setLocationText] = useState("");
  const [website, setWebsite] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [checkedNames, setCheckedNames] = useState<
    Record<string, { available: boolean }>
  >({});
  const [usernameFailure, setUsernameFailure] = useState<{
    name: string;
    message: string;
  } | null>(null);

  // Uploads
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingStory, setUploadingStory] = useState(false);

  // Overlays
  const [profilePhotoViewerOpen, setProfilePhotoViewerOpen] = useState(false);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<{
    userid: string;
    username: string;
    profileimage?: string;
  } | null>(null);
  const [friendBusy, setFriendBusy] = useState("");

  // Story viewer
  const [ringLoading, setRingLoading] = useState(false);
  const [storyViewerOpen, setStoryViewerOpen] = useState(false);
  const [storyIndex, setStoryIndex] = useState(0);
  const [storyError, setStoryError] = useState("");
  const [deletingStory, setDeletingStory] = useState(false);

  // Stories that are still inside their 24 hours, oldest first.
  const activeStories = (profile?.stories ?? [])
    .filter(isStoryActive)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  const hasUnseenStories = activeStories.some((story) => !story.seen);
  const currentStory = storyViewerOpen ? activeStories[storyIndex] : undefined;

  const patchProfile = (changes: Partial<ProfileData>) =>
    setProfile((previous) => (previous ? { ...previous, ...changes } : previous));

  const markStorySeen = (storyId: string) =>
    setProfile((previous) =>
      previous
        ? {
            ...previous,
            stories: (previous.stories ?? []).map((story) =>
              story.storyId === storyId ? { ...story, seen: true } : story,
            ),
          }
        : previous,
    );

  // ---------------- Loading ----------------

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      if (userid) {
        const response = await profileService.getPublicProfile(userid);

        if (response.data.relationship === "self") {
          // Opened our own profile through a link: show the full own view.
          const mine = await profileService.getMyProfile();
          setSelfView(true);
          setProfile(mine.data.profile);
          setOwnName(mine.data.user.name || "");
          setOwnEmail(mine.data.user.email || "");
          setOwnPhoto(mine.data.user.profilePhoto || "");
        } else {
          setSelfView(false);
          setProfile(response.data);
          setOwnName("");
          setOwnEmail("");
          setOwnPhoto("");
        }
      } else {
        setSelfView(false);
        const response = await profileService.getMyProfile();
        setProfile(response.data.profile);
        setOwnName(response.data.user.name || "");
        setOwnEmail(response.data.user.email || "");
        setOwnPhoto(response.data.user.profilePhoto || "");
      }
    } catch (err: unknown) {
      const message = errMsg(err, "Unable to load profile.");

      if (
        message.toLowerCase().includes("unauthorized") ||
        message.toLowerCase().includes("authentication")
      ) {
        navigate("/", { replace: true });
        return;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [userid, navigate]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  // Re-render every minute so expired stories (and their ring) disappear on time.
  useEffect(() => {
    const id = window.setInterval(() => setClock((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Success messages dismiss themselves.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // ---------------- Username availability ----------------

  const normalizedUsername = username.trim().toLowerCase();
  const isCurrentUsername =
    Boolean(profile) &&
    normalizedUsername === (profile?.username ?? "").toLowerCase();
  const validUsername = USERNAME_PATTERN.test(normalizedUsername);
  const checkedResult = checkedNames[normalizedUsername];

  const getUsernameStatus = (): { state: UsernameState; message: string } => {
    if (!normalizedUsername) return { state: "idle", message: "" };
    if (isCurrentUsername) {
      return { state: "available", message: "This is your current username." };
    }
    if (!validUsername) {
      return {
        state: "invalid",
        message: "Use 3–30 letters, numbers, dots, or underscores.",
      };
    }
    if (checkedResult) {
      return checkedResult.available
        ? { state: "available", message: "Username available." }
        : {
            state: "taken",
            message: "Username already taken. Try another one.",
          };
    }
    if (usernameFailure?.name === normalizedUsername) {
      return { state: "error", message: usernameFailure.message };
    }
    return { state: "checking", message: "Checking username..." };
  };

  const usernameStatus = getUsernameStatus();

  // Debounced check. Results are cached per username, so typing the same name
  // again never calls the API twice.
  useEffect(() => {
    if (!editorOpen || isCurrentUsername || !validUsername || checkedResult) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const response =
          await profileService.checkUsernameAvailability(normalizedUsername);

        setCheckedNames((previous) => ({
          ...previous,
          [normalizedUsername]: { available: response.data.available },
        }));
      } catch (err: unknown) {
        setUsernameFailure({
          name: normalizedUsername,
          message: errMsg(err, "Unable to check username."),
        });
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [
    editorOpen,
    isCurrentUsername,
    validUsername,
    normalizedUsername,
    checkedResult,
  ]);

  // ---------------- Editing ----------------

  const openEditor = () => {
    if (!profile) return;
    setUsername(profile.username || "");
    setBio(profile.bio || "");
    setLocationText(profile.location || "");
    setWebsite(profile.website || "");
    setIsPrivate(Boolean(profile.isPrivate));
    setCheckedNames({});
    setUsernameFailure(null);
    setError("");
    setNotice("");
    setEditorOpen(true);
  };

  const saveDetails = async () => {
    if (saving || !profile) return;

    if (usernameStatus.state !== "available") {
      setError(
        usernameStatus.state === "checking"
          ? "Please wait while we check the username."
          : "Choose a username that is marked as available.",
      );
      return;
    }

    // Send only what actually changed; no changes means no API call.
    const changes: ProfileUpdateData = {};

    if (normalizedUsername !== profile.username.toLowerCase()) {
      changes.username = normalizedUsername;
    }
    if (bio.trim() !== (profile.bio || "")) changes.bio = bio.trim();
    if (locationText.trim() !== (profile.location || "")) {
      changes.location = locationText.trim();
    }
    if (website.trim() !== (profile.website || "")) {
      changes.website = website.trim();
    }
    if (isPrivate !== Boolean(profile.isPrivate)) changes.isPrivate = isPrivate;

    if (Object.keys(changes).length === 0) {
      setEditorOpen(false);
      setNotice("No changes to save.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await profileService.updateMyProfile(changes);

      // The response already holds the fresh profile, so no extra GET is needed.
      setProfile(response.data.profile);
      setOwnName(response.data.user.name || "");
      setOwnPhoto(response.data.user.profilePhoto || "");
      setCheckedNames({});
      setEditorOpen(false);
      setNotice("Your profile has been updated.");
    } catch (err: unknown) {
      setError(errMsg(err, "Unable to save profile."));
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Image uploads (profile, cover, story) ----------------

  const uploadAndSaveImage = async (file: File, kind: ImageKind) => {
    setError("");
    setNotice("");

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setError("Images must be 5 MB or smaller.");
      return;
    }

    const setBusy = {
      profile: setUploadingProfile,
      cover: setUploadingCover,
      story: setUploadingStory,
    }[kind];

    setBusy(true);

    try {
      // 1. Upload the file to Cloudinary through the backend.
      const upload = await profileService.uploadImage(file);
      const imageUrl = upload.data.secureUrl;

      // 2. Save the Cloudinary URL in MongoDB and 3. update the screen
      //    from the response (no full profile reload).
      if (kind === "story") {
        const response = await profileService.createStory(imageUrl);
        const newStory = response.data.story;

        setProfile((previous) =>
          previous
            ? {
                ...previous,
                stories: [
                  ...(previous.stories ?? []).filter(isStoryActive),
                  newStory,
                ],
              }
            : previous,
        );
        setNotice("Story published. It disappears after 24 hours.");
      } else if (kind === "profile") {
        await profileService.updateProfileImage({ profileimage: imageUrl });
        patchProfile({ profileimage: imageUrl });
        setOwnPhoto(imageUrl);
        setNotice("Profile photo updated.");
      } else {
        const response = await profileService.updateMyProfile({
          coverimage: imageUrl,
        });
        patchProfile({ coverimage: response.data.profile.coverimage });
        setNotice("Cover photo updated.");
      }
    } catch (err: unknown) {
      setError(errMsg(err, "Image upload failed."));
    } finally {
      setBusy(false);
    }
  };

  const handleFile =
    (kind: ImageKind) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void uploadAndSaveImage(file, kind);
    };

  // ---------------- People and posts ----------------

  const openProfile = (targetId: string) => {
    if (!targetId) return;
    setFriendsOpen(false);
    setRequestsOpen(false);
    navigate(`/profile/${targetId}`);
  };

  // Opens the full post (same card as the feed) at /profile/:userid/posts/:postId
  const openPost = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const postId = typeof record.postId === "string" ? record.postId : "";
    const ownerId =
      typeof record.userid === "string" && record.userid
        ? record.userid
        : (profile?.userid ?? "");

    if (postId && ownerId) navigate(`/profile/${ownerId}/posts/${postId}`);
  };

  const setFriendRelation = (id: string, relationship: Relationship) =>
    setProfile((previous) =>
      previous
        ? {
            ...previous,
            friends: previous.friends.map((friend) =>
              friend.userid === id ? { ...friend, relationship } : friend,
            ),
          }
        : previous,
    );

  const sendRequest = async (targetId: string) => {
    if (friendBusy) return;
    setFriendBusy(targetId);
    setError("");

    try {
      await profileService.sendFriendRequest(targetId);

      if (profile && targetId === profile.userid) {
        patchProfile({ relationship: "requested" });
      } else {
        setFriendRelation(targetId, "requested");
      }

      setNotice("Friend request sent.");
    } catch (err: unknown) {
      setError(errMsg(err, "Unable to send the friend request."));
    } finally {
      setFriendBusy("");
    }
  };

  const acceptRequest = async (requesterId: string) => {
    if (friendBusy) return;
    setFriendBusy(requesterId);
    setError("");

    try {
      await profileService.acceptFriendRequest(requesterId);

      setProfile((previous) => {
        if (!previous) return previous;

        if (ownProfile) {
          const incoming = (previous.requests ?? []) as IncomingRequest[];
          const match = incoming.find(
            (item) => item.profile?.userid === requesterId,
          );
          const who = match ? requestIdentity(match, 0) : null;

          return {
            ...previous,
            requests: incoming.filter(
              (item) => item.profile?.userid !== requesterId,
            ),
            friends: previous.friends.some(
              (friend) => friend.userid === requesterId,
            )
              ? previous.friends
              : [
                  ...previous.friends,
                  {
                    userid: requesterId,
                    username: who?.name ?? "",
                    friendshipAccepted: true,
                    profileimage: who?.photo ?? "",
                    relationship: "friends" as Relationship,
                  },
                ],
          };
        }

        if (previous.userid === requesterId) {
          return { ...previous, relationship: "friends" as Relationship };
        }

        return {
          ...previous,
          friends: previous.friends.map((friend) =>
            friend.userid === requesterId
              ? { ...friend, relationship: "friends" as Relationship }
              : friend,
          ),
        };
      });

      setNotice("Friend request accepted.");
    } catch (err: unknown) {
      setError(errMsg(err, "Unable to accept the friend request."));
    } finally {
      setFriendBusy("");
    }
  };

  const declineRequest = async (requesterId: string) => {
    if (friendBusy) return;
    setFriendBusy(requesterId);
    setError("");

    try {
      await profileService.declineFriendRequest(requesterId);

      setProfile((previous) =>
        previous
          ? {
              ...previous,
              requests: ((previous.requests ?? []) as IncomingRequest[]).filter(
                (item) => item.profile?.userid !== requesterId,
              ),
            }
          : previous,
      );
    } catch (err: unknown) {
      setError(errMsg(err, "Unable to decline the friend request."));
    } finally {
      setFriendBusy("");
    }
  };

  // ---------------- Stories ----------------

  const closeStoryViewer = useCallback(() => {
    setStoryViewerOpen(false);
    setStoryError("");
  }, []);

  // Click on the profile image: spin the ring for 1.5 s, then show the story.
  // With no active story it opens the profile photo instead.
  const handleAvatarClick = async () => {
    if (ringLoading) return;

    if (activeStories.length === 0) {
      setProfilePhotoViewerOpen(true);
      return;
    }

    const firstUnseen = activeStories.findIndex((story) => !story.seen);
    const startIndex = firstUnseen === -1 ? 0 : firstUnseen;
    const startedAt = Date.now();

    setRingLoading(true);
    setStoryError("");

    let failure = "";

    try {
      await preloadImage(activeStories[startIndex].imageUrl);
    } catch (err: unknown) {
      failure = errMsg(err, "Unable to load this story.");
    }

    await wait(Math.max(0, RING_LOADING_MS - (Date.now() - startedAt)));

    setStoryIndex(startIndex);
    setStoryError(failure);
    setStoryViewerOpen(true);
    setRingLoading(false);
  };

  const changeStory = (direction: 1 | -1) => {
    const next = storyIndex + direction;

    if (next >= activeStories.length) {
      closeStoryViewer();
      return;
    }

    setStoryError("");
    setStoryIndex(Math.max(0, next));
  };

  const removeCurrentStory = async () => {
    const story = currentStory;
    if (!story || deletingStory) return;

    setDeletingStory(true);
    setStoryError("");

    try {
      await profileService.deleteStory(story.storyId);

      const remaining = activeStories.filter(
        (item) => item.storyId !== story.storyId,
      );

      patchProfile({ stories: remaining });
      setNotice("Story deleted.");

      if (remaining.length === 0) {
        closeStoryViewer();
      } else {
        setStoryIndex(Math.min(storyIndex, remaining.length - 1));
      }
    } catch (err: unknown) {
      setStoryError(errMsg(err, "Unable to delete story."));
    } finally {
      setDeletingStory(false);
    }
  };

  // Record the view (user id + email are taken from the login on the server).
  useEffect(() => {
    if (!currentStory || !profile) return;
    if (currentStory.seen || reportedViews.current.has(currentStory.storyId)) {
      return;
    }

    reportedViews.current.add(currentStory.storyId);
    markStorySeen(currentStory.storyId);

    void profileService
      .viewStory(profile.userid, currentStory.storyId)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStory, profile?.userid]);

  // Move to the next story automatically.
  useEffect(() => {
    if (!storyViewerOpen || !currentStory) return;

    const timer = window.setTimeout(() => {
      if (storyIndex + 1 >= activeStories.length) {
        closeStoryViewer();
      } else {
        setStoryError("");
        setStoryIndex(storyIndex + 1);
      }
    }, STORY_DURATION_MS);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyViewerOpen, storyIndex, currentStory?.storyId, activeStories.length]);

  // Warm the cache for the next story.
  useEffect(() => {
    if (!storyViewerOpen) return;
    const next = activeStories[storyIndex + 1];
    if (next) new Image().src = next.imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyViewerOpen, storyIndex]);

  // ---------------- Loading / error screens ----------------

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

  // ---------------- Derived values ----------------

  const displayName =
    ownName || profile.name || profile.username || "JobDrips member";
  const avatar = profile.profileimage || ownPhoto;

  const education: Education = profile.education ?? { school: [], college: [] };
  const experience: Experience[] = profile.experience ?? [];

  const friends: Friend[] = (profile.friends || []).filter(
    (friend: Friend) => friend.friendshipAccepted,
  );

  const pendingRequests = (
    ownProfile ? ((profile.requests || []) as IncomingRequest[]) : []
  ).filter((request) => request.accept !== true);

  const posts = profile.posts || [];
  const mentions = profile.mentionedPosts || [];
  const saved = profile.savedPosts || [];
  const relationship: Relationship = profile.relationship ?? "none";
  const postsCount = profile.postsCount ?? posts.length;

  const restricted =
    !ownProfile &&
    Boolean(profile.isPrivate) &&
    Boolean(profile.postAccessRestricted);

  const complete = Boolean(
    profile.bio?.trim() &&
      avatar &&
      education.school.length + education.college.length + experience.length >
        0,
  );

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "posts", label: "Posts", count: postsCount },
    { id: "mentions", label: "Mentions", count: mentions.length },
    ...(ownProfile
      ? [{ id: "saved" as Tab, label: "Saved", count: saved.length }]
      : []),
  ];

  const showRing = hasUnseenStories || ringLoading;
  const latestRole = experience[0];

  const usernameBoxClass =
    usernameStatus.state === "available"
      ? "border-green-300 bg-green-50 text-green-700"
      : usernameStatus.state === "taken" ||
          usernameStatus.state === "invalid" ||
          usernameStatus.state === "error"
        ? "border-red-300 bg-red-50 text-red-700"
        : "border-[#E6D5C9] bg-[#FFF8F3] text-[#80695D]";

  return (
    <main className="min-h-screen bg-[#FBF6F1] pb-8 text-[#30231E]">
      <style>{`
        @keyframes jd-spin { to { transform: rotate(360deg); } }
        @keyframes jd-story-progress { from { width: 0%; } to { width: 100%; } }
        @media (prefers-reduced-motion: reduce) {
          [data-jd-motion] { animation-duration: 3s !important; }
        }
      `}</style>

      {/* Hidden file inputs (always mounted so the + button works) */}
      <input
        ref={profileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={handleFile("profile")}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={handleFile("cover")}
      />
      <input
        ref={storyInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={handleFile("story")}
      />

      <div className="mx-auto max-w-2xl sm:px-5 sm:pt-5">
        <section className="overflow-hidden bg-white shadow-[0_8px_32px_rgba(103,62,42,0.07)] sm:rounded-[30px] sm:border sm:border-[#EBDCD1]">
          {/* Cover */}
          <div className="relative h-56 overflow-hidden bg-gradient-to-br from-[#F3DCCE] via-[#D5AB94] to-[#8F5844] sm:h-72">
            {profile.coverimage && (
              <img
                src={profile.coverimage}
                alt="Profile cover"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#38241C]/25 via-transparent to-black/5" />
          </div>

          {/* Profile card */}
          <div className="relative flow-root -mt-6 rounded-t-[28px] bg-white px-5 pb-6 sm:px-8">
            {ownProfile && (
              <button
                type="button"
                onClick={openEditor}
                aria-label="Edit profile"
                title="Edit profile"
                className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-[#E9D2C3] bg-[#FFF8F3] text-[#985438] shadow-sm sm:right-6"
              >
                <Icon d={ICONS.pencil} />
              </button>
            )}

            {/* Profile photo with story ring and + button */}
            <div className="relative mx-auto -mt-[72px] h-36 w-36 sm:-mt-20 sm:h-40 sm:w-40">
              <button
                type="button"
                onClick={() => void handleAvatarClick()}
                aria-label={
                  activeStories.length > 0 ? "View story" : "View profile photo"
                }
                className="relative block h-full w-full overflow-hidden rounded-[30px] bg-white p-[4px] shadow-[0_7px_20px_rgba(87,51,35,0.18)]"
              >
                {showRing && (
                  <span
                    aria-hidden="true"
                    data-jd-motion
                    className="absolute -inset-[60%] bg-[conic-gradient(from_0deg,#F8CF75,#E94E76,#9A55D8,#43304E,#F8CF75)]"
                    style={
                      ringLoading
                        ? { animation: "jd-spin 0.9s linear infinite" }
                        : undefined
                    }
                  />
                )}
                <span className="relative block h-full w-full rounded-[26px] bg-white p-[3px]">
                  <span className="block h-full w-full overflow-hidden rounded-[22px] bg-[#F2DFD3]">
                    {avatar ? (
                      <img
                        src={avatar}
                        alt={displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F4E4D9] to-[#D8AE96] text-5xl font-black text-[#985438]">
                        {displayName.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </span>
                </span>
              </button>

              {ownProfile && (
                <button
                  type="button"
                  disabled={uploadingStory}
                  onClick={() => storyInputRef.current?.click()}
                  aria-label="Add story"
                  title="Add story"
                  className="absolute -bottom-1 -right-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-gradient-to-br from-[#D39472] to-[#994D35] text-white shadow-md disabled:opacity-70"
                >
                  {uploadingStory ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" />
                  ) : (
                    <Icon d={ICONS.plus} className="h-5 w-5" />
                  )}
                </button>
              )}
            </div>

            {/* Name, tick, username, bio */}
            <div className="mt-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <h1 className="min-w-0 break-words text-2xl font-black tracking-tight sm:text-3xl">
                  {displayName}
                </h1>
                <VerifiedBadge />
              </div>
              <p className="mt-1 text-sm font-semibold text-[#9B8174]">
                @{profile.username}
              </p>
              {ownProfile && ownEmail && (
                <p className="mt-0.5 text-xs text-[#B2A096]">{ownEmail}</p>
              )}
              <p className="mx-auto mt-3 max-w-md whitespace-pre-wrap break-words text-sm leading-6 text-[#4A3A32]">
                {profile.bio ||
                  (ownProfile ? "Add a bio to tell people about yourself." : "")}
              </p>
            </div>

            {/* Location, website, role, joined */}
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] text-[#68564D]">
              {profile.location && (
                <p className="flex min-w-0 items-center gap-2.5">
                  <Icon d={ICONS.pin} className="h-5 w-5 shrink-0 text-[#B45E40]" />
                  <span className="truncate">{profile.location}</span>
                </p>
              )}
              {profile.website && (
                <a
                  href={websiteHref(profile.website)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 items-center gap-2.5 font-semibold text-[#A4543A]"
                >
                  <Icon d={ICONS.link} className="h-5 w-5 shrink-0 text-[#B45E40]" />
                  <span className="truncate">{websiteLabel(profile.website)}</span>
                </a>
              )}
              {latestRole && (
                <p className="col-span-2 flex min-w-0 items-center gap-2.5">
                  <Icon
                    d={ICONS.briefcase}
                    className="h-5 w-5 shrink-0 text-[#B45E40]"
                  />
                  <span className="truncate">
                    {latestRole.role}
                    {latestRole.company ? ` at ${latestRole.company}` : ""}
                  </span>
                </p>
              )}
              <p className="col-span-2 flex items-center gap-2.5">
                <Icon
                  d={ICONS.calendar}
                  className="h-5 w-5 shrink-0 text-[#B45E40]"
                />
                Joined {formatDate(profile.createdAt)}
              </p>
            </div>

            {/* Friends, requests, posts */}
            <div className="mt-5 grid w-full grid-cols-3">
              <button
                type="button"
                onClick={() => setFriendsOpen(true)}
                aria-label="View friends"
                className="flex min-w-0 flex-col items-center gap-1 px-1 py-2 transition active:opacity-60"
              >
                <span className="flex min-h-[28px] max-w-full items-center justify-center gap-1.5">
                  <span className="text-lg font-black leading-none sm:text-xl">
                    {friends.length}
                  </span>
                  <AvatarStack
                    items={friends.map((friend) => ({
                      src: friend.profileimage,
                      name: friend.username,
                    }))}
                  />
                  <Icon
                    d={ICONS.chevron}
                    className="h-4 w-4 shrink-0 text-[#80695D]"
                  />
                </span>
                <span className="text-xs font-semibold text-[#80695D]">
                  Friends
                </span>
              </button>

              {ownProfile && (
                <button
                  type="button"
                  onClick={() => setRequestsOpen(true)}
                  aria-label="View incoming friend requests"
                  className="flex min-w-0 flex-col items-center gap-1 px-1 py-2 transition active:opacity-60"
                >
                  <span className="flex min-h-[28px] max-w-full items-center justify-center gap-1.5">
                    <span className="text-lg font-black leading-none sm:text-xl">
                      {pendingRequests.length}
                    </span>
                    <AvatarStack
                      items={pendingRequests.map((request, index) => {
                        const who = requestIdentity(request, index);
                        return { src: who.photo, name: who.name };
                      })}
                    />
                    <Icon
                      d={ICONS.chevron}
                      className="h-4 w-4 shrink-0 text-[#80695D]"
                    />
                  </span>
                  <span className="text-xs font-semibold text-[#80695D]">
                    Requests
                  </span>
                </button>
              )}

              <div className="flex min-w-0 flex-col items-center gap-1 px-1 py-2">
                <span className="flex min-h-[28px] items-center justify-center">
                  <span className="text-lg font-black leading-none sm:text-xl">
                    {postsCount}
                  </span>
                </span>
                <span className="text-xs font-semibold text-[#80695D]">
                  Posts
                </span>
              </div>

              {!ownProfile && (
                <div className="flex min-w-0 items-center justify-center px-1 py-2">
                  {relationship === "friends" ? (
                    <button
                      type="button"
                      onClick={() =>
                        setMessageTarget({
                          userid: profile.userid,
                          username: profile.username,
                          profileimage: avatar,
                        })
                      }
                      className={actionPillClass}
                    >
                      Message
                    </button>
                  ) : relationship === "requested" ? (
                    <span className={mutedPillClass}>Requested</span>
                  ) : relationship === "received" ? (
                    <button
                      type="button"
                      disabled={friendBusy === profile.userid}
                      onClick={() => void acceptRequest(profile.userid)}
                      className={actionPillClass}
                    >
                      Accept
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={friendBusy === profile.userid}
                      onClick={() => void sendRequest(profile.userid)}
                      className={actionPillClass}
                    >
                      Add friend
                    </button>
                  )}
                </div>
              )}
            </div>

            {!complete && ownProfile && (
              <div className="mt-4 rounded-2xl border border-[#EBD7C8] bg-[#FFFBF8] p-4">
                <p className="font-extrabold">Complete your profile</p>
                <p className="mt-1 text-sm text-[#80695D]">
                  Add a bio, profile photo, education, or experience.
                </p>
                <button
                  type="button"
                  onClick={openEditor}
                  className="mt-3 rounded-full bg-[#A4543A] px-4 py-2 text-sm font-bold text-white"
                >
                  Add details
                </button>
              </div>
            )}
          </div>
        </section>

        {(error || notice) && !editorOpen && (
          <div
            role={error ? "alert" : "status"}
            className={`mx-3 mt-4 rounded-2xl border p-4 text-sm sm:mx-0 ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-[#EBD7C8] bg-white text-[#80533E]"
            }`}
          >
            {error || notice}
            <button
              type="button"
              onClick={() => {
                setError("");
                setNotice("");
              }}
              className="ml-3 font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Posts, mentions, saved */}
        <section className="mt-4 overflow-hidden border-y border-[#EBDCD1] bg-white sm:rounded-2xl sm:border">
          <div className="flex border-b border-[#EBDCD1]">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex-1 py-3.5 text-sm font-extrabold transition ${
                    active ? "text-[#A4543A]" : "text-[#8D776B]"
                  }`}
                >
                  {tab.label}
                  <span className="ml-1 text-xs opacity-70">{tab.count}</span>
                  {active && (
                    <span className="absolute inset-x-6 bottom-0 h-[3px] rounded-full bg-[#A4543A]" />
                  )}
                </button>
              );
            })}
          </div>

          {restricted ? (
            <div className="px-5 py-12 text-center sm:py-16">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F8E9E3] text-[#A4543A]">
                <Icon d={ICONS.lock} className="h-8 w-8" />
              </div>
              <h2 className="mt-5 text-xl font-black">This account is private</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#80695D]">
                Become friends with this member to see their posts.
              </p>
            </div>
          ) : (
            <PostGrid
              onOpen={openPost}
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
                  ? ownProfile
                    ? "Your story starts here"
                    : "No posts yet"
                  : activeTab === "mentions"
                    ? "No mentions yet"
                    : "Nothing saved yet"
              }
              emptyText={
                activeTab === "posts"
                  ? "Posts appear here once they are shared."
                  : activeTab === "mentions"
                    ? "Posts mentioning this member will appear here."
                    : "Posts you save will appear here."
              }
            />
          )}
        </section>
      </div>

      {/* ---------------- Edit profile ---------------- */}
      {editorOpen && ownProfile && (
        <Sheet
          wide
          title={complete ? "Edit your profile" : "Complete your profile"}
          subtitle="Photos, education and experience save as soon as you change them. Use Save changes for the details below."
          onClose={() => setEditorOpen(false)}
        >
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#E6D5C9] bg-white p-4">
              <p className="text-sm font-bold text-[#463229]">Profile photo</p>
              <div className="mt-3 flex items-center gap-3">
                <Avatar
                  src={avatar}
                  name={displayName}
                  square
                  className="h-16 w-16 text-2xl"
                />
                <div className="min-w-0">
                  <p className="text-xs leading-5 text-[#80695D]">
                    JPEG, PNG or WebP · Max 5 MB
                  </p>
                  <button
                    type="button"
                    disabled={uploadingProfile}
                    onClick={() => profileInputRef.current?.click()}
                    className={`mt-2 ${smallButtonClass}`}
                  >
                    {uploadingProfile
                      ? "Uploading..."
                      : avatar
                        ? "Change photo"
                        : "Add photo"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[#E6D5C9] bg-white p-4">
              <p className="text-sm font-bold text-[#463229]">Cover photo</p>
              <div className="mt-3 h-16 overflow-hidden rounded-xl bg-gradient-to-br from-[#F3DCCE] via-[#D5AB94] to-[#8F5844]">
                {profile.coverimage && (
                  <img
                    src={profile.coverimage}
                    alt="Cover preview"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <button
                type="button"
                disabled={uploadingCover}
                onClick={() => coverInputRef.current?.click()}
                className={`mt-3 ${smallButtonClass}`}
              >
                {uploadingCover
                  ? "Uploading..."
                  : profile.coverimage
                    ? "Change cover"
                    : "Add cover"}
              </button>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-sm font-bold text-[#463229]">
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  maxLength={30}
                  autoComplete="username"
                  placeholder="your.username"
                  className={`mt-1.5 h-12 w-full rounded-xl border bg-white px-4 font-normal outline-none focus:ring-2 ${
                    usernameStatus.state === "available"
                      ? "border-green-500 focus:border-green-500 focus:ring-green-500/15"
                      : usernameStatus.state === "taken" ||
                          usernameStatus.state === "invalid" ||
                          usernameStatus.state === "error"
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500/15"
                        : "border-[#E6D5C9] focus:border-[#B87556] focus:ring-[#B87556]/15"
                  }`}
                />
              </label>
              {usernameStatus.message && (
                <p
                  role="status"
                  className={`mt-2 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${usernameBoxClass}`}
                >
                  {usernameStatus.state === "checking" && (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                  {usernameStatus.message}
                </p>
              )}
            </div>

            <label className="block text-sm font-bold text-[#463229]">
              About you
              <textarea
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Your role, skills and interests..."
                className="mt-1.5 w-full resize-y rounded-xl border border-[#E6D5C9] bg-white p-4 font-normal outline-none focus:border-[#B87556] focus:ring-2 focus:ring-[#B87556]/15"
              />
              <span className="mt-1 block text-right text-xs font-normal text-[#9B8174]">
                {bio.length}/500
              </span>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm font-bold text-[#463229]">
                Location
                <input
                  value={locationText}
                  onChange={(event) => setLocationText(event.target.value)}
                  maxLength={100}
                  placeholder="Karnataka, India"
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-bold text-[#463229]">
                Website
                <input
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  maxLength={200}
                  placeholder="yourname.dev"
                  className={inputClass}
                />
              </label>
            </div>

            <EducationEditor
              education={education}
              onChange={(next) => {
                setError("");
                patchProfile({ education: next });
              }}
              onError={setError}
            />

            <ExperienceEditor
              experience={experience}
              onChange={(next) => {
                setError("");
                patchProfile({ experience: next });
              }}
              onError={setError}
            />

            <label className="flex items-center gap-3 rounded-xl border border-[#E6D5C9] bg-white p-4">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
                className="h-4 w-4 accent-[#A4543A]"
              />
              <span>
                <span className="block text-sm font-bold text-[#463229]">
                  Private profile
                </span>
                <span className="mt-1 block text-xs font-normal leading-5 text-[#80695D]">
                  Only accepted friends can see your posts, stories and details.
                </span>
              </span>
            </label>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"
            >
              {error}
            </p>
          )}
          {notice && !error && (
            <p
              role="status"
              className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-700"
            >
              {notice}
            </p>
          )}

          <button
            type="button"
            disabled={saving || usernameStatus.state !== "available"}
            onClick={() => void saveDetails()}
            className="mt-6 w-full rounded-full bg-gradient-to-r from-[#CB8969] to-[#994D35] px-6 py-3.5 font-extrabold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving changes..." : "Save changes"}
          </button>
        </Sheet>
      )}

      {/* ---------------- Friends ---------------- */}
      {friendsOpen && (
        <Sheet
          title="Friends"
          subtitle={`${friends.length} ${friends.length === 1 ? "friend" : "friends"}`}
          onClose={() => setFriendsOpen(false)}
        >
          {friends.length ? (
            <ul className="mt-5 space-y-3">
              {friends.map((friend) => {
                const relation: Relationship = ownProfile
                  ? "friends"
                  : (friend.relationship ?? "none");

                return (
                  <li
                    key={friend.userid}
                    className="flex items-center gap-3 rounded-2xl border border-[#EBDCD1] bg-white p-3"
                  >
                    <button
                      type="button"
                      onClick={() => openProfile(friend.userid)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Avatar
                        src={friend.profileimage}
                        name={friend.username}
                        className="h-12 w-12"
                      />
                      <span className="truncate text-sm font-bold">
                        @{friend.username}
                      </span>
                    </button>

                    {relation === "friends" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFriendsOpen(false);
                          setMessageTarget({
                            userid: friend.userid,
                            username: friend.username,
                            profileimage: friend.profileimage,
                          });
                        }}
                        className={actionPillClass}
                      >
                        Message
                      </button>
                    ) : relation === "requested" ? (
                      <span className={mutedPillClass}>Requested</span>
                    ) : relation === "received" ? (
                      <button
                        type="button"
                        disabled={friendBusy === friend.userid}
                        onClick={() => void acceptRequest(friend.userid)}
                        className={actionPillClass}
                      >
                        Accept
                      </button>
                    ) : relation === "self" ? null : (
                      <button
                        type="button"
                        disabled={friendBusy === friend.userid}
                        onClick={() => void sendRequest(friend.userid)}
                        className={actionPillClass}
                      >
                        Add friend
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-10 text-center">
              <p className="font-bold">No friends yet</p>
              <p className="mt-2 text-sm text-[#80695D]">
                Accepted friends will appear here.
              </p>
            </div>
          )}
        </Sheet>
      )}

      {/* ---------------- Incoming requests ---------------- */}
      {requestsOpen && ownProfile && (
        <Sheet
          title="Friend requests"
          subtitle={`${pendingRequests.length} pending incoming ${
            pendingRequests.length === 1 ? "request" : "requests"
          }`}
          onClose={() => setRequestsOpen(false)}
        >
          {pendingRequests.length ? (
            <ul className="mt-5 space-y-3">
              {pendingRequests.map((request, index) => {
                const who = requestIdentity(request, index);

                return (
                  <li
                    key={who.key}
                    className="flex items-center gap-3 rounded-2xl border border-[#EBDCD1] bg-white p-3"
                  >
                    <button
                      type="button"
                      onClick={() => openProfile(who.key)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Avatar src={who.photo} name={who.name} className="h-12 w-12" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold">
                          {who.name}
                        </span>
                        <span className="block text-xs text-[#80695D]">
                          Sent you a friend request
                        </span>
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={friendBusy === who.key}
                      onClick={() => void acceptRequest(who.key)}
                      className={actionPillClass}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={friendBusy === who.key}
                      onClick={() => void declineRequest(who.key)}
                      className="rounded-full border border-[#E0CFC4] px-3 py-2 text-xs font-bold text-[#8D776B] disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="py-10 text-center">
              <p className="font-bold">No pending requests</p>
              <p className="mt-2 text-sm text-[#80695D]">
                New incoming friend requests will appear here.
              </p>
            </div>
          )}
        </Sheet>
      )}

      {/* ---------------- Message a friend ---------------- */}
      {messageTarget && (
        <MessageSheet
          recipient={messageTarget}
          onClose={() => setMessageTarget(null)}
        />
      )}

      {/* ---------------- Profile photo viewer ---------------- */}
      {profilePhotoViewerOpen && (
        <div
          className="fixed inset-0 z-[190] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setProfilePhotoViewerOpen(false)}
        >
          <button
            type="button"
            onClick={() => setProfilePhotoViewerOpen(false)}
            aria-label="Close profile photo"
            className="absolute right-5 top-5 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-3xl text-white"
          >
            ×
          </button>
          {avatar ? (
            <img
              src={avatar}
              alt={`${displayName} profile photo`}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[85dvh] max-w-full rounded-2xl object-contain shadow-2xl"
            />
          ) : (
            <div
              onClick={(event) => event.stopPropagation()}
              className="flex h-64 w-64 items-center justify-center rounded-3xl bg-gradient-to-br from-[#F4E4D9] to-[#D8AE96] text-8xl font-black text-[#985438]"
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
      )}

      {/* ---------------- Story viewer ---------------- */}
      {storyViewerOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#140D0B] p-0 sm:p-4">
          <div className="relative flex h-[100dvh] w-full max-w-md items-center justify-center overflow-hidden bg-black sm:h-[min(92dvh,850px)] sm:rounded-3xl">
            {currentStory ? (
              <>
                {storyError ? (
                  <p className="px-6 text-center text-sm text-white/80">
                    {storyError}
                  </p>
                ) : (
                  <img
                    src={currentStory.imageUrl}
                    alt="Story"
                    onError={() =>
                      setStoryError("Unable to load this story image.")
                    }
                    className="absolute inset-0 h-full w-full object-contain"
                  />
                )}

                {/* Progress bars */}
                <div className="absolute left-3 right-3 top-3 z-20 flex gap-1">
                  {activeStories.map((story, index) => (
                    <span
                      key={story.storyId}
                      className="h-1 flex-1 overflow-hidden rounded-full bg-white/35"
                    >
                      <span
                        key={`${story.storyId}-${
                          index < storyIndex
                            ? "done"
                            : index === storyIndex
                              ? "run"
                              : "todo"
                        }`}
                        data-jd-motion
                        className="block h-full rounded-full bg-white"
                        style={
                          index < storyIndex
                            ? { width: "100%" }
                            : index === storyIndex
                              ? {
                                  animation: `jd-story-progress ${STORY_DURATION_MS}ms linear forwards`,
                                }
                              : { width: "0%" }
                        }
                      />
                    </span>
                  ))}
                </div>

                {/* Header */}
                <div className="absolute left-4 right-4 top-7 z-20 flex items-center justify-between text-white drop-shadow">
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={avatar}
                      name={displayName}
                      className="h-9 w-9 border border-white/70"
                    />
                    <div className="leading-tight">
                      <p className="text-sm font-bold">@{profile.username}</p>
                      <p className="text-[11px] text-white/75">
                        {timeAgo(currentStory.createdAt)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeStoryViewer}
                    aria-label="Close story"
                    className="h-10 w-10 rounded-full bg-black/30 text-3xl"
                  >
                    ×
                  </button>
                </div>

                {/* Tap zones */}
                <button
                  type="button"
                  aria-label="Previous story"
                  onClick={() => changeStory(-1)}
                  className="absolute inset-y-20 left-0 z-10 w-1/3"
                />
                <button
                  type="button"
                  aria-label="Next story"
                  onClick={() => changeStory(1)}
                  className="absolute inset-y-20 right-0 z-10 w-2/3"
                />

                {/* Footer (views and delete are for the owner) */}
                {ownProfile && (
                  <div className="absolute bottom-5 left-4 right-4 z-20 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 text-xs font-bold text-white">
                      <Icon d={ICONS.eye} className="h-4 w-4" />
                      {currentStory.viewCount ?? 0}{" "}
                      {(currentStory.viewCount ?? 0) === 1 ? "view" : "views"}
                    </span>
                    <button
                      type="button"
                      disabled={deletingStory}
                      onClick={() => void removeCurrentStory()}
                      className="rounded-full bg-black/50 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {deletingStory ? "Deleting..." : "Delete story"}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="px-6 text-center text-white">
                <p>No active stories.</p>
                <button
                  type="button"
                  onClick={closeStoryViewer}
                  className="mt-5 rounded-full bg-white/15 px-5 py-2"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default Profile;
