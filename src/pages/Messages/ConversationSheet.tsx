import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

type ConversationSheetProps = { open: boolean; background?: string; children: ReactNode };

const backgroundStyle = (background?: string): CSSProperties | undefined => {
  if (!background) return undefined;
  if (background.startsWith("image:")) {
    return { backgroundImage: `url("${background.slice(6)}")`, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
  return { background };
};

/** Full-viewport conversation surface covering the app header and bottom nav. */
export default function ConversationSheet({ open, background, children }: ConversationSheetProps) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] h-[100dvh] w-screen overflow-hidden bg-[#fffaf6] text-[#30241f]"
      style={backgroundStyle(background)}
      role="dialog" aria-modal="true" aria-label="Conversation"
    >
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">{children}</div>
    </div>,
    document.body,
  );
}