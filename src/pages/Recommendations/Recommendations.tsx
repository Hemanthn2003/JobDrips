import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

type Mutual = { userid: string; username: string; name: string; profileimage: string };
type Item = {
  userid: string;
  name: string;
  username: string;
  profileimage: string;
  headline: string;
  location: string;
  mutualCount: number;
  mutualFriends: Mutual[];
  tags: string[];
  matchPercent: number;
  recommendedOn: string;
};
type ApiResult<T> = { success: boolean; message?: string; data: T };
type Tab = "people" | "companies" | "jobs";
type Filter = "all" | "college" | "industry" | "nearby";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "people", label: "People" },
  { key: "companies", label: "Companies" },
  { key: "jobs", label: "Jobs" },
];

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "college", label: "Same College" },
  { key: "industry", label: "Same Industry" },
  { key: "nearby", label: "Nearby" },
];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error(body.message || "Request failed.");
  return body as T;
}

const profilePath = (userid: string) => `/profile/${encodeURIComponent(userid)}`;
const initial = (value = "") => value.trim().slice(0, 1).toUpperCase() || "J";

function Photo({ src, name, className }: { src?: string; name: string; className: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} grid place-items-center bg-[#f2dfd3] font-bold text-[#91452f]`}>
      {initial(name)}
    </span>
  );
}

function Card({
  item,
  requested,
  busy,
  onOpen,
  onConnect,
  onSkip,
  onMutual,
}: {
  item: Item;
  requested: boolean;
  busy: boolean;
  onOpen: (item: Item) => void;
  onConnect: (item: Item) => void;
  onSkip: (item: Item) => void;
  onMutual: (item: Item) => void;
}) {
  const stack = item.mutualFriends.slice(0, 3);

  return (
    <li className="flex items-center gap-3 rounded-2xl border border-[#f0e6df] bg-white/85 p-3 shadow-[0_1px_3px_rgba(80,50,30,0.05)]">
      <button type="button" onClick={() => onOpen(item)} aria-label={`Open ${item.name}'s profile`} className="shrink-0">
        <Photo src={item.profileimage} name={item.name} className="h-[68px] w-[68px] rounded-2xl sm:h-[76px] sm:w-[76px]" />
      </button>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => onOpen(item)} className="block max-w-full text-left">
          <span className="block truncate text-[15px] font-bold leading-5 text-[#2b201b]">{item.name}</span>
        </button>
        {item.headline && <p className="mt-0.5 truncate text-sm leading-5 text-[#7b6a60]">{item.headline}</p>}
        {item.location && <p className="truncate text-sm leading-5 text-[#8b7a70]">{item.location}</p>}

        {/* Nothing is shown when there are no mutual friends. */}
        {item.mutualCount > 0 && (
          <button
            type="button"
            onClick={() => onMutual(item)}
            className="mt-1 flex max-w-full items-center gap-1.5 text-left"
            aria-label={`See ${item.mutualCount} mutual connections`}
          >
            <span className="flex shrink-0 -space-x-1.5">
              {stack.map((friend) => (
                <Photo
                  key={friend.userid}
                  src={friend.profileimage}
                  name={friend.name}
                  className="h-5 w-5 rounded-full text-[10px] ring-2 ring-white"
                />
              ))}
            </span>
            <span className="truncate text-xs text-[#8b7a70]">
              {item.mutualCount} mutual {item.mutualCount === 1 ? "connection" : "connections"}
            </span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy || requested}
          onClick={() => onConnect(item)}
          className={`h-10 min-w-[88px] rounded-xl px-3 text-sm font-semibold transition sm:min-w-[104px] ${
            requested
              ? "border border-[#e3cfc4] bg-white text-[#9a6a56]"
              : "bg-gradient-to-b from-[#c98366] to-[#a5482f] text-white shadow-[0_2px_6px_rgba(152,69,47,0.35)] hover:brightness-105 disabled:opacity-60"
          }`}
        >
          {requested ? "Requested" : busy ? "Sending…" : "Connect"}
        </button>

        {!requested && (
          <button
            type="button"
            onClick={() => onSkip(item)}
            aria-label={`Remove ${item.name} from recommendations`}
            className="grid h-8 w-8 place-items-center rounded-full text-[#8b7a70] transition hover:bg-[#f5ebe5] hover:text-[#5a483f]"
          >
            <X size={18} />
          </button>
        )}
      </div>
    </li>
  );
}

const Recommendations = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("people");
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<Item[]>([]);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [requested, setRequested] = useState<Set<string>>(() => new Set());
  const [mutualFor, setMutualFor] = useState<Item | null>(null);
  const loadRequest = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (loadRequest.current) return loadRequest.current;
    const request = Promise.resolve().then(async () => {
      setError("");
      try {
        const result = await api<ApiResult<{ items: Item[]; needsProfile: boolean }>>("/api/recommendations");
        setItems(result.data.items);
        setNeedsProfile(result.data.needsProfile);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load your recommendations.");
      } finally {
        setLoading(false);
        if (loadRequest.current === request) loadRequest.current = null;
      }
    });
    loadRequest.current = request;
    return request;
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.tags.includes(filter))),
    [items, filter],
  );

  // Opening a profile marks the person as seen (so they never turn "unseen").
  const open = (item: Item) => {
    void api(`/api/recommendations/${encodeURIComponent(item.userid)}/seen`, { method: "POST" }).catch(() => undefined);
    navigate(profilePath(item.userid));
  };

  const connect = async (item: Item) => {
    if (busyId) return;
    setBusyId(item.userid);
    setError("");
    try {
      await api(`/api/profiles/${encodeURIComponent(item.userid)}/friend-request`, { method: "POST" });
      setRequested((old) => new Set(old).add(item.userid));
      void api(`/api/recommendations/${encodeURIComponent(item.userid)}/added`, { method: "POST" }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to send the friend request.");
    } finally {
      setBusyId("");
    }
  };

  // X: the card disappears at once and the person is saved as "skipped".
  const skip = async (item: Item) => {
    const previous = items;
    setItems((old) => old.filter((entry) => entry.userid !== item.userid));
    try {
      await api(`/api/recommendations/${encodeURIComponent(item.userid)}/skip`, { method: "POST" });
    } catch (e) {
      setItems(previous);
      setError(e instanceof Error ? e.message : "Unable to remove this person.");
    }
  };

  const emptyText = needsProfile
    ? "Add a bio, your experience or some hashtags to your profile and we will find people like you."
    : filter === "all"
      ? "No new recommendations right now. Check back soon."
      : "Nobody matches this filter right now.";

  return (
    <div className="mx-auto w-full max-w-[640px] pb-6">
      {/* People / Companies / Jobs */}
      <div role="tablist" className="mb-4 grid grid-cols-3 border-b border-[#eee4dd]">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-2 py-3 text-[15px] font-semibold transition ${
              tab === key
                ? "border-[#c0492f] text-[#b4432f]"
                : "border-transparent text-[#8b7a70] hover:text-[#5a483f]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab !== "people" ? (
        <div className="rounded-2xl border border-[#eee4dd] bg-white/80 px-6 py-14 text-center">
          <h2 className="text-base font-bold text-[#332720]">
            {tab === "companies" ? "Company" : "Job"} recommendations are coming soon
          </h2>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-6 text-[#8b7a70]">
            For now, discover people you may know in the People tab.
          </p>
        </div>
      ) : (
        <>
          <h1 className="mb-3 text-xl font-black text-[#2b201b]">People You May Know</h1>

          <div
            className="mb-4 flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: "none" }}
            role="group"
            aria-label="Filter people"
          >
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-full px-5 py-2 text-sm font-semibold transition ${
                  filter === key
                    ? "bg-[#8d3a28] text-white shadow-sm"
                    : "border border-[#eadfd6] bg-[#f6efe9] text-[#5a483f] hover:bg-[#f1e7df]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <p role="alert" className="mb-3 flex items-center justify-between rounded-xl bg-[#fdeeea] px-4 py-3 text-sm text-[#b4432f]">
              <span>{error}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setError("")}><X size={16} /></button>
            </p>
          )}

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((key) => (
                <div key={key} className="h-[96px] animate-pulse rounded-2xl bg-[#f4efeb]" />
              ))}
            </div>
          )}

          {!loading && visible.length === 0 && !error && (
            <div className="rounded-2xl border border-[#eee4dd] bg-white/80 px-6 py-14 text-center text-sm leading-6 text-[#8b7a70]">
              {emptyText}
            </div>
          )}

          {!loading && visible.length > 0 && (
            <ul className="space-y-3">
              {visible.map((item) => (
                <Card
                  key={item.userid}
                  item={item}
                  requested={requested.has(item.userid)}
                  busy={busyId === item.userid}
                  onOpen={open}
                  onConnect={(entry) => void connect(entry)}
                  onSkip={(entry) => void skip(entry)}
                  onMutual={setMutualFor}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* Mutual connections list */}
      {mutualFor && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setMutualFor(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Mutual connections"
            className="flex max-h-[80dvh] w-full max-w-md flex-col rounded-t-3xl bg-[#fffaf6] p-5 shadow-xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#2b201b]">
                Mutual connections · {mutualFor.mutualCount}
              </h2>
              <button type="button" aria-label="Close" onClick={() => setMutualFor(null)} className="rounded-full p-1.5 hover:bg-[#f5ebe5]">
                <X size={20} />
              </button>
            </div>
            <p className="mb-2 text-xs text-[#8b7a70]">You and {mutualFor.name} both know:</p>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {mutualFor.mutualFriends.map((friend) => (
                <li key={friend.userid}>
                  <button
                    type="button"
                    onClick={() => { setMutualFor(null); navigate(profilePath(friend.userid)); }}
                    className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-[#fff0e7]"
                  >
                    <Photo src={friend.profileimage} name={friend.name} className="h-10 w-10 shrink-0 rounded-full" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[#2b201b]">{friend.name}</span>
                      {friend.username && <span className="block truncate text-xs text-[#8b7a70]">@{friend.username}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default Recommendations;
