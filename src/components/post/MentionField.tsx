import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { loadFriends } from "../../services/postService";
import type { PostPerson } from "../../services/postService";
import { PersonAvatar } from "./postUtils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  className?: string;
  /** Pressing Enter (without Shift) calls this, for single-line comment boxes. */
  onSubmit?: () => void;
  /** Change this number to move the cursor into the field. */
  focusSignal?: number;
}

/** The "@name" being typed right before the cursor, if any. */
const activeToken = (text: string, caret: number) => {
  const match = /(?:^|\s)@([A-Za-z0-9_.]*)$/.exec(text.slice(0, caret));
  return match ? { query: match[1] ?? "", start: caret - (match[1] ?? "").length - 1 } : null;
};

export default function MentionField({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  maxLength,
  className = "",
  onSubmit,
  focusSignal = 0,
}: Props) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [friends, setFriends] = useState<PostPerson[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const token = activeToken(value, caret);

  // Friends are fetched once, the first time someone types "@".
  useEffect(() => {
    if (!token || friends.length > 0) return;
    let cancelled = false;

    loadFriends()
      .then((list) => {
        if (!cancelled) setFriends(list);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token, friends.length]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    setCaret(field.value.length);
  }, [focusSignal]);

  const suggestions =
    token && !dismissed
      ? friends
          .filter((friend) =>
            friend.username.toLowerCase().includes(token.query.toLowerCase()),
          )
          .slice(0, 6)
      : [];

  const syncCaret = () => {
    const field = fieldRef.current;
    if (field) setCaret(field.selectionStart ?? field.value.length);
  };

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setDismissed(false);
    setCaret(event.target.selectionStart ?? event.target.value.length);
    onChange(event.target.value);
  };

  const pick = (friend: PostPerson) => {
    if (!token) return;

    const insert = `@${friend.username} `;
    const next = value.slice(0, token.start) + insert + value.slice(caret);
    const position = token.start + insert.length;

    onChange(next);
    setCaret(position);

    window.setTimeout(() => {
      const field = fieldRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(position, position);
    }, 0);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape" && suggestions.length > 0) {
      event.preventDefault();
      setDismissed(true);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && onSubmit && !multiline) {
      event.preventDefault();
      if (suggestions.length > 0 && suggestions[0]) {
        pick(suggestions[0]);
      } else {
        onSubmit();
      }
    }
  };

  const shared = {
    value,
    placeholder,
    maxLength,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onKeyUp: syncCaret,
    onClick: syncCaret,
    className,
  };

  return (
    <div className="relative min-w-0 flex-1">
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 max-h-56 w-full min-w-[220px] overflow-y-auto rounded-xl border border-[#eee4dd] bg-white py-1 shadow-lg"
        >
          {suggestions.map((friend) => (
            <li key={friend.userid}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(friend)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[#f8f1ec]"
              >
                <PersonAvatar
                  src={friend.profileimage}
                  name={friend.username}
                  className="h-7 w-7"
                />
                <span className="truncate text-sm font-semibold text-[#332720]">
                  @{friend.username}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {multiline ? (
        <textarea
          {...shared}
          rows={rows}
          ref={(element) => {
            fieldRef.current = element;
          }}
        />
      ) : (
        <input
          {...shared}
          type="text"
          ref={(element) => {
            fieldRef.current = element;
          }}
        />
      )}
    </div>
  );
}
