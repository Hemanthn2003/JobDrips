import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";

const API = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const CACHE_MS = 60_000;

type Relation = "friend" | "suggested" | "requested" | "none";
type Tab = "people" | "posts";

interface PersonResult {
  userid: string;
  username: string;
  name: string;
  profileimage: string;
  headline: string;
  isPrivate: boolean;
  relation: Relation;
  mutualCount: number;
  mutualFriends: Array<{ userid: string; name: string; profileimage: string }>;
  matchPercent: number;
  reason: string;
}

interface PostResult {
  postId: string;
  ownerId: string;
  username: string;
  name: string;
  profileimage: string;
  snippet: string;
  image: string;
  likeCount: number;
  relation: Relation;
  matchPercent: number;
}

interface SearchData {
  query: string;
  people: PersonResult[];
  posts: PostResult[];
}

const RELATION_LABEL: Record<Relation, string> = {
  friend: "Friend",
  suggested: "Suggested",
  requested: "Requested",
  none: "",
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const initialOf = (value = "") => value.trim().slice(0, 1).toUpperCase() || "J";

function Avatar({
  src,
  name,
  className,
}: {
  src?: string;
  name: string;
  className: string;
}) {
  return src ? (
    <img src={src} alt="" loading="lazy" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} grid place-items-center bg-[#f2dfd3] font-bold text-[#91452f]`}>
      {initialOf(name)}
    </span>
  );
}

/** Makes the typed letters bold ("ar" in arun). */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!text || terms.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  return (
    <>
      {text.split(pattern).map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="bg-transparent font-extrabold text-[#A4543A]">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const isRecommendationsActive =
    location.pathname === "/recommendations";

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("people");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<SearchData | null>(null);
  const [active, setActive] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cacheRef = useRef(new Map<string, { at: number; data: SearchData }>());

  const text = query.trim();
  const enough = text.replace(/\s/g, "").length >= MIN_CHARS;
  const terms = useMemo(
    () => [...new Set(text.toLowerCase().split(/\s+/).filter(Boolean))],
    [text],
  );

  // ---- debounced search: waits until the user stops typing ----
  useEffect(() => {
    if (!enough) {
      setResults(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    const key = text.toLowerCase();
    const cached = cacheRef.current.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      setResults(cached.data);
      setLoading(false);
      setError("");
      return undefined;
    }

    setLoading(true);
    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API}/api/search?q=${encodeURIComponent(text)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.success === false) {
          throw new Error(body.message || "Search failed.");
        }

        if (cacheRef.current.size > 30) cacheRef.current.clear();
        cacheRef.current.set(key, { at: Date.now(), data: body.data as SearchData });

        setResults(body.data as SearchData);
        setError("");
        setActive(-1);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [text, enough]);

  // ---- close on outside click and when the page changes ----
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const people = results?.people ?? [];
  const posts = results?.posts ?? [];
  const list = tab === "people" ? people : posts;

  const finish = () => {
    setOpen(false);
    setQuery("");
    setResults(null);
    setActive(-1);
  };

  const openPerson = (person: PersonResult) => {
    navigate(`/profile/${encodeURIComponent(person.userid)}`);
    finish();
  };

  const openPost = (post: PostResult) => {
    navigate(`/profile/${encodeURIComponent(post.ownerId)}/posts/${encodeURIComponent(post.postId)}`);
    finish();
  };

  const openAt = (index: number) => {
    if (tab === "people") {
      const person = people[index];
      if (person) openPerson(person);
    } else {
      const post = posts[index];
      if (post) openPost(post);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!enough || list.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % list.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? list.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      openAt(active >= 0 ? active : 0);
    }
  };

  const showPanel = open && text.length > 0;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--jd-border)] bg-[var(--jd-surface)]/97 shadow-[0_2px_16px_rgba(79,43,28,0.09)] backdrop-blur-xl">
      <div
        className="
          mx-auto
          flex
          h-[72px]
          w-full
          max-w-[820px]
          items-center
          gap-0
          px-1
          sm:h-[78px]
          sm:gap-1
          sm:px-2
          md:h-[86px]
          md:gap-2
          md:px-3
          lg:h-[92px]
          lg:gap-3
          lg:px-4
          xl:h-[96px]
          xl:px-5
        "
      >
        <Link
          to="/feed"
          className="flex h-full shrink-0 items-center"
          aria-label="JobDrips Feed"
        >
          <img
            src="/assets/logo/jobdrips-logo.svg"
            alt="JobDrips"
            className="
              h-[52px]
              w-auto
              max-w-[175px]
              object-contain
              sm:h-[58px]
              sm:max-w-[205px]
              md:h-[66px]
              md:max-w-[235px]
              lg:h-[72px]
              lg:max-w-[265px]
              xl:h-[76px]
              xl:max-w-[285px]
            "
          />
        </Link>

        <div className="flex min-w-0 flex-1 justify-center px-1 sm:px-1 md:px-2">
          <div
            ref={wrapperRef}
            className="
              relative
              w-full
              max-w-[500px]
              sm:max-w-[580px]
              md:max-w-[660px]
              lg:max-w-[740px]
              xl:max-w-[800px]
            "
          >
            <img
              src="/assets/icons/header/search.svg"
              alt=""
              className="
                pointer-events-none
                absolute
                left-3
                top-1/2
                h-[19px]
                w-[19px]
                -translate-y-1/2
                opacity-75
                sm:left-3
                sm:h-[20px]
                sm:w-[20px]
                md:left-4
                md:h-[21px]
                md:w-[21px]
              "
            />

            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              autoComplete="off"
              enterKeyHint="search"
              role="combobox"
              aria-expanded={showPanel}
              aria-controls="header-search-results"
              aria-autocomplete="list"
              aria-label="Search people and posts"
              placeholder="Search people, jobs, posts..."
              className="
                h-[42px]
                w-full
                rounded-full
                border
                border-[var(--jd-input-border)]
                bg-[var(--jd-warm-white)]
                pl-10
                pr-4
                text-[12px]
                font-medium
                text-[var(--jd-primary-text)]
                outline-none
                transition-all
                duration-200
                placeholder:text-[var(--jd-placeholder)]
                focus:border-[var(--jd-rose-gold)]
                focus:bg-[var(--jd-surface)]
                focus:ring-2
                focus:ring-[var(--jd-champagne)]
                sm:h-[46px]
                sm:pl-10
                sm:text-[13px]
                md:h-[50px]
                md:pl-11
                md:text-[14px]
                lg:h-[54px]
                lg:pl-12
                lg:text-[15px]
              "
            />

            {showPanel && (
              <div
                id="header-search-results"
                className="fixed inset-x-2 top-[76px] z-[60] overflow-hidden rounded-2xl border border-[#eee4dd] bg-[#fffaf6] shadow-[0_14px_34px_rgba(79,43,28,0.20)] sm:absolute sm:inset-x-0 sm:top-full sm:mt-2"
              >
                {/* People | Posts */}
                <div role="tablist" className="grid grid-cols-2 border-b border-[#eee4dd]">
                  {([
                    ["people", "People", people.length],
                    ["posts", "Posts", posts.length],
                  ] as Array<[Tab, string, number]>).map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      onClick={() => { setTab(key); setActive(-1); }}
                      className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-semibold transition ${
                        tab === key
                          ? "border-[#c0492f] text-[#b4432f]"
                          : "border-transparent text-[#8b7a70] hover:text-[#5a483f]"
                      }`}
                    >
                      {label}
                      {enough && results ? ` (${count})` : ""}
                    </button>
                  ))}
                </div>

                {loading && results && <div className="h-0.5 animate-pulse bg-[#c77e5d]" />}

                <div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1.5">
                  {!enough && (
                    <p className="px-3 py-6 text-center text-[13px] text-[#8b7a70]">
                      Keep typing — at least {MIN_CHARS} letters.
                    </p>
                  )}

                  {enough && loading && !results && (
                    <div className="space-y-2 p-2">
                      {[1, 2, 3].map((key) => (
                        <div key={key} className="h-12 animate-pulse rounded-xl bg-[#f4efeb]" />
                      ))}
                    </div>
                  )}

                  {enough && error && (
                    <p role="alert" className="px-3 py-6 text-center text-[13px] text-[#b4432f]">
                      {error}
                    </p>
                  )}

                  {enough && !error && results && list.length === 0 && (
                    <p className="px-3 py-6 text-center text-[13px] leading-5 text-[#8b7a70]">
                      {tab === "people" ? "No profiles" : "No posts"} found for “{text}”.
                    </p>
                  )}

                  {enough && !error && results && tab === "people" && people.length > 0 && (
                    <ul role="listbox" aria-label="People">
                      {people.map((person, index) => (
                        <li key={person.userid} role="option" aria-selected={active === index}>
                          <button
                            type="button"
                            onMouseEnter={() => setActive(index)}
                            onClick={() => openPerson(person)}
                            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                              active === index ? "bg-[#fff0e7]" : "hover:bg-[#fff7f2]"
                            }`}
                          >
                            <Avatar src={person.profileimage} name={person.name} className="h-11 w-11 shrink-0 rounded-full" />

                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[14px] font-bold leading-5 text-[#2b201b]">
                                  <Highlight text={person.name} terms={terms} />
                                </span>
                                {person.isPrivate && <Lock size={12} className="shrink-0 text-[#8b7a70]" aria-label="Private account" />}
                              </span>

                              <span className="block truncate text-xs leading-4 text-[#8b7a70]">
                                @<Highlight text={person.username} terms={terms} />
                                {person.headline ? ` · ${person.headline}` : ""}
                              </span>

                              {person.reason === "private-posts" && (
                                <span className="block truncate text-[11px] leading-4 text-[#a4543a]">
                                  Private account · has posts about “{text}”
                                </span>
                              )}

                              {person.mutualCount > 0 && (
                                <span className="mt-0.5 flex items-center gap-1.5">
                                  <span className="flex shrink-0 -space-x-1.5">
                                    {person.mutualFriends.map((friend) => (
                                      <Avatar
                                        key={friend.userid}
                                        src={friend.profileimage}
                                        name={friend.name}
                                        className="h-4 w-4 rounded-full text-[8px] ring-2 ring-[#fffaf6]"
                                      />
                                    ))}
                                  </span>
                                  <span className="truncate text-[11px] text-[#8b7a70]">
                                    {person.mutualCount} mutual {person.mutualCount === 1 ? "friend" : "friends"}
                                  </span>
                                </span>
                              )}
                            </span>

                            {RELATION_LABEL[person.relation] && (
                              <span className="shrink-0 rounded-full bg-[#f2dfd3] px-2 py-0.5 text-[11px] font-semibold text-[#91452f]">
                                {RELATION_LABEL[person.relation]}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {enough && !error && results && tab === "posts" && posts.length > 0 && (
                    <ul role="listbox" aria-label="Posts">
                      {posts.map((post, index) => (
                        <li key={`${post.ownerId}-${post.postId}`} role="option" aria-selected={active === index}>
                          <button
                            type="button"
                            onMouseEnter={() => setActive(index)}
                            onClick={() => openPost(post)}
                            className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition ${
                              active === index ? "bg-[#fff0e7]" : "hover:bg-[#fff7f2]"
                            }`}
                          >
                            <Avatar src={post.profileimage} name={post.name} className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />

                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-bold leading-5 text-[#2b201b]">{post.name}</span>
                                {RELATION_LABEL[post.relation] && (
                                  <span className="shrink-0 rounded-full bg-[#f2dfd3] px-1.5 text-[10px] font-semibold text-[#91452f]">
                                    {RELATION_LABEL[post.relation]}
                                  </span>
                                )}
                              </span>
                              <span
                                className="mt-0.5 block text-[13px] leading-[18px] text-[#5a483f]"
                                style={{
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                }}
                              >
                                <Highlight text={post.snippet} terms={terms} />
                              </span>
                            </span>

                            {post.image && (
                              <img src={post.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <Link
          to="/recommendations"
          aria-label="Recommendations"
          aria-current={isRecommendationsActive ? "page" : undefined}
          className={`
            flex
            h-[45px]
            w-[45px]
            shrink-0
            items-center
            justify-center
            rounded-[13px]
            border
            transition-all
            duration-300
            sm:h-[50px]
            sm:w-[50px]
            md:h-[55px]
            md:w-[55px]
            lg:h-[60px]
            lg:w-[60px]
            ${
              isRecommendationsActive
                ? "scale-105 border-[#71391F] bg-[#71391F] shadow-[0_3px_12px_rgba(113,57,31,0.30)]"
                : "border-[#A9684E] bg-[#A9684E] hover:scale-105 hover:border-[#96563D] hover:bg-[#96563D]"
            }
          `}
        >
          <img
            src="/assets/icons/header/recommendations-active.svg"
            alt=""
            className="
              h-[34px]
              w-[34px]
              object-contain
              sm:h-[37px]
              sm:w-[37px]
              md:h-[41px]
              md:w-[41px]
              lg:h-[45px]
              lg:w-[45px]
            "
          />
        </Link>
      </div>
    </header>
  );
};

export default Header;
