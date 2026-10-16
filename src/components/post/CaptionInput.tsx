import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { postComposerService } from "../../services/postComposerService";
import type { HashtagSuggestion, MentionSuggestion } from "../../services/postComposerService";

/**
 * Caption box with #hashtag and @mention suggestions (list opens BELOW the box).
 *  - "#" + first letter → hashtags from the DB containing that text, most used first.
 *    Hashtags are case-sensitive: #job, #Job and #JOB are listed (and counted) separately.
 *  - "@" (+ letters)    → your accepted friends whose username contains that text.
 * Typing something new is fine: the server registers new hashtags (count 1) on post.
 */

type Trigger = { type: "#" | "@"; query: string; start: number };
type Item =
  | { kind: "tag"; data: HashtagSuggestion }
  | { kind: "user"; data: MentionSuggestion };
type Status = "idle" | "loading" | "done" | "error";

const TRIGGER_RE = /(?:^|\s)(?:#([\p{L}\p{N}_]*)|@([\p{L}\p{N}_.]*))$/u;

const detect = (text: string, caret: number): Trigger | null => {
  const m = TRIGGER_RE.exec(text.slice(0, caret));
  if (!m) return null;
  const isTag = m[1] !== undefined;
  const query = (isTag ? m[1] : m[2]) ?? "";
  return { type: isTag ? "#" : "@", query, start: caret - query.length - 1 };
};

interface Props {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
}

const CaptionInput = ({ value, onChange, maxLength = 5000, placeholder }: Props) => {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState<Status>("idle");

  /* ---- fetch suggestions (debounced, cancels stale requests) ---- */
  useEffect(() => {
    // "#" needs at least one letter; "@" alone already lists your friends.
    if (!trigger || (trigger.type === "#" && trigger.query.length < 1)) {
      setItems([]);
      setStatus("idle");
      return;
    }
    const ctrl = new AbortController();
    setStatus("loading");
    const t = window.setTimeout(async () => {
      try {
        if (trigger.type === "#") {
          const tags = await postComposerService.searchHashtags(trigger.query, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setItems(tags.map((data) => ({ kind: "tag", data })));
        } else {
          const users = await postComposerService.searchMentions(trigger.query, ctrl.signal);
          if (ctrl.signal.aborted) return;
          setItems(users.map((data) => ({ kind: "user", data })));
        }
        setActive(0);
        setStatus("done");
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error("Suggestion request failed:", err);
        setItems([]);
        setStatus("error");
      }
    }, 150);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [trigger?.type, trigger?.query]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshTrigger = () => {
    const el = taRef.current;
    if (!el) return;
    setTrigger(detect(el.value, el.selectionStart));
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    setTrigger(detect(e.target.value, e.target.selectionStart));
  };

  const pick = (item: Item) => {
    const el = taRef.current;
    if (!el || !trigger) return;
    const caret = el.selectionStart;
    const insert = item.kind === "tag" ? `#${item.data.hashtag} ` : `@${item.data.username} `;
    const next = value.slice(0, trigger.start) + insert + value.slice(caret);
    onChange(next);
    setTrigger(null);
    setItems([]);
    const pos = trigger.start + insert.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const open = !!trigger && status !== "idle";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape") {
      setTrigger(null);
    }
  };

  const emptyMessage = () => {
    if (!trigger) return "";
    if (trigger.type === "#")
      return `No saved hashtag matches. "#${trigger.query}" will be created when you post.`;
    return trigger.query
      ? `None of your friends match "@${trigger.query}".`
      : "You have no friends to mention yet.";
  };

  return (
    <div>
      <div className="relative">
        <textarea
          ref={taRef}
          value={value}
          onChange={handleChange}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) refreshTrigger();
          }}
          onClick={refreshTrigger}
          onBlur={() => window.setTimeout(() => setTrigger(null), 120)}
          maxLength={maxLength}
          placeholder={placeholder ?? "What's on your mind?"}
          className="block min-h-[190px] w-full resize-none rounded-2xl border border-[var(--jd-border,#EBD7CD)] bg-white/55 px-4 py-3.5 text-[16px] leading-relaxed text-[#2b1a14] outline-none placeholder:text-[#a68f84] focus:border-[#C8704F]"
        />

        {open && (
          <ul
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-[232px] overflow-y-auto rounded-xl border border-[var(--jd-border,#EBD7CD)] bg-white py-1 shadow-[0_10px_28px_rgba(79,43,28,0.18)]"
          >
            {items.length === 0 && status === "loading" && (
              <li className="px-3.5 py-2.5 text-[13px] text-[#a68f84]">Searching…</li>
            )}
            {status === "error" && (
              <li className="px-3.5 py-2.5 text-[13px] font-semibold text-[#9A2F1B]">
                Couldn't load suggestions. Check your connection or sign in again.
              </li>
            )}
            {status === "done" && items.length === 0 && (
              <li className="px-3.5 py-2.5 text-[13px] text-[#a68f84]">{emptyMessage()}</li>
            )}
            {items.map((item, i) => (
              <li
                key={item.kind === "tag" ? item.data.hashtagId : item.data.userId}
                role="option"
                aria-selected={i === active}
                // mousedown (not click) so the textarea keeps focus
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 px-3.5 py-2 ${
                  i === active ? "bg-[#FBEDE6]" : ""
                }`}
              >
                {item.kind === "tag" ? (
                  <>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F4DDD2] text-[15px] font-black text-[#A5472F]">
                      #
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[#2b1a14]">
                      #{item.data.hashtag}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-[#a68f84]">
                      {item.data.usesCount.toLocaleString()} {item.data.usesCount === 1 ? "post" : "posts"}
                    </span>
                  </>
                ) : (
                  <>
                    {item.data.profileImage ? (
                      <img src={item.data.profileImage} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F4DDD2] text-[13px] font-black uppercase text-[#A5472F]">
                        {item.data.username.slice(0, 1)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold text-[#2b1a14]">
                        @{item.data.username}
                      </span>
                      {item.data.fullName && (
                        <span className="block truncate text-[12px] text-[#a68f84]">{item.data.fullName}</span>
                      )}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-1.5 text-right text-[12px] font-semibold text-[#a68f84]">
        {value.length}/{maxLength}
      </p>
    </div>
  );
};

export default CaptionInput;