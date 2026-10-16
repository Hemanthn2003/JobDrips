import type { PollDraft } from "../../services/postComposerService";
import { IconClose, IconPoll } from "./PostIcons";

interface Props {
  value: PollDraft;
  onChange: (next: PollDraft) => void;
  onRemove: () => void;
}

const DURATIONS: { days: PollDraft["durationDays"]; label: string }[] = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
];

export const isPollValid = (p: PollDraft | null) =>
  !!p &&
  p.question.trim().length > 0 &&
  p.options.filter((o) => o.trim()).length >= 2 &&
  new Set(p.options.filter((o) => o.trim()).map((o) => o.trim().toLowerCase())).size ===
    p.options.filter((o) => o.trim()).length;

const PollComposer = ({ value, onChange, onRemove }: Props) => {
  const setOption = (i: number, text: string) =>
    onChange({ ...value, options: value.options.map((o, idx) => (idx === i ? text : o)) });

  return (
    <section className="rounded-2xl border border-[var(--jd-border,#EBD7CD)] bg-white/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[15px] font-extrabold text-[#2b1a14]">
          <IconPoll className="h-5 w-5 text-[#A5472F]" />
          Poll
        </h3>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove poll"
          className="rounded-full p-1.5 text-[#7a5b4e] hover:bg-black/5"
        >
          <IconClose className="h-5 w-5" />
        </button>
      </div>

      <input
        value={value.question}
        onChange={(e) => onChange({ ...value, question: e.target.value })}
        maxLength={200}
        placeholder="Ask a question…"
        className="w-full rounded-xl border border-[var(--jd-border,#EBD7CD)] bg-white px-3.5 py-2.5 text-[15px] font-semibold text-[#2b1a14] outline-none placeholder:font-medium placeholder:text-[#a68f84] focus:border-[#C8704F]"
      />

      <div className="mt-3 space-y-2">
        {value.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              maxLength={80}
              placeholder={`Option ${i + 1}`}
              className="min-w-0 flex-1 rounded-xl border border-[var(--jd-border,#EBD7CD)] bg-white px-3.5 py-2.5 text-[14px] text-[#2b1a14] outline-none placeholder:text-[#a68f84] focus:border-[#C8704F]"
            />
            {value.options.length > 2 && (
              <button
                type="button"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => onChange({ ...value, options: value.options.filter((_, idx) => idx !== i) })}
                className="rounded-full p-1.5 text-[#7a5b4e] hover:bg-black/5"
              >
                <IconClose className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {value.options.length < 4 && (
        <button
          type="button"
          onClick={() => onChange({ ...value, options: [...value.options, ""] })}
          className="mt-2.5 text-[14px] font-bold text-[#A5472F]"
        >
          + Add option
        </button>
      )}

      <div className="mt-4 flex items-center gap-2">
        <span className="mr-1 text-[13px] font-semibold text-[#7a5b4e]">Poll length</span>
        {DURATIONS.map((d) => (
          <button
            key={d.days}
            type="button"
            onClick={() => onChange({ ...value, durationDays: d.days })}
            className={`rounded-full border px-3 py-1 text-[13px] font-bold ${
              value.durationDays === d.days
                ? "border-[#A5472F] bg-[#A5472F] text-white"
                : "border-[var(--jd-border,#EBD7CD)] text-[#7a5b4e]"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </section>
  );
};

export default PollComposer;
