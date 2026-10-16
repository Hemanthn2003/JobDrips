import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * The ONE confirmation modal for the whole app.
 * Use it instead of window.alert / window.confirm / window.prompt, on every page.
 *
 *   <ConfirmModal
 *     open={show}
 *     title="Discard this post?"
 *     message="Everything you've added here will be lost."
 *     confirmLabel="Discard"
 *     danger
 *     onConfirm={doIt}
 *     onCancel={() => setShow(false)}
 *   />
 *
 * Notice-only (replaces alert): pass hideCancel and use onConfirm to close it.
 */
interface Props {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red-ish confirm button for destructive actions. */
  danger?: boolean;
  /** Disables both buttons while an action is running. */
  busy?: boolean;
  /** Only show the confirm button (acts as an "OK" notice). */
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}: Props) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Safe default focus: Cancel when it exists, otherwise the only button.
    (hideCancel ? confirmRef.current : cancelRef.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, hideCancel, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/45 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
      >
        <h2 id="confirm-modal-title" className="text-[18px] font-extrabold text-[#2b1a14]">
          {title}
        </h2>
        {message && <div className="mt-1.5 text-[14px] text-[#7a5b4e]">{message}</div>}

        <div className="mt-5 flex gap-3">
          {!hideCancel && (
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex-1 rounded-xl border border-[var(--jd-border,#EBD7CD)] py-2.5 text-[15px] font-bold text-[#3b2a23] disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 rounded-xl py-2.5 text-[15px] font-bold text-white disabled:opacity-50 ${
              danger ? "bg-[#B3261E]" : "bg-[#A5472F]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;