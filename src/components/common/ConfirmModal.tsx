import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** "danger" makes the confirm button red (delete, remove, leave). */
  tone?: "default" | "danger";
};

type ModalProps = ConfirmOptions & {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Reusable confirmation dialog. Always above every sheet / viewer in the app. */
export function ConfirmModal({
  open, title, message, confirmText = "Confirm", cancelText = "Cancel", tone = "default", busy = false, onConfirm, onCancel,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center bg-[#2D1D16]/60 p-5 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
    >
      <section role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-sm rounded-[28px] border border-[#EBDCD1] bg-[#FFFCF9] p-6 text-center text-[#30241f] shadow-2xl">
        <h2 className="text-xl font-black">{title}</h2>
        {message && <div className="mt-2 text-sm leading-6 text-[#80695D]">{message}</div>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-full border border-[#E0CFC4] bg-white px-5 py-3 text-sm font-bold text-[#6F5A4E] disabled:opacity-60">{cancelText}</button>
          <button
            type="button" disabled={busy} onClick={onConfirm}
            className={`rounded-full px-5 py-3 text-sm font-extrabold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 ${tone === "danger" ? "bg-[#B4432F] hover:bg-[#9A3826]" : "bg-gradient-to-r from-[#CB8969] to-[#994D35]"}`}
          >
            {busy ? "Please wait…" : confirmText}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Promise-based confirm, a drop-in replacement for window.confirm:
 *
 *   const { confirm, dialog } = useConfirm();
 *   if (!(await confirm({ title: "Delete?", tone: "danger", confirmText: "Delete" }))) return;
 *   ...
 *   return (<> ...page... {dialog} </>);
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback(
    (next: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const dialog = (
    <ConfirmModal
      open={options !== null}
      title={options?.title ?? ""}
      message={options?.message}
      confirmText={options?.confirmText}
      cancelText={options?.cancelText}
      tone={options?.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, dialog };
}