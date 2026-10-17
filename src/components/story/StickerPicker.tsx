import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";

// Full sticker list from the `emoji-picker-react` package. Loaded lazily by StickerList,
// so the package is only downloaded when someone opens the sticker panel.
export default function StickerPicker({ onPick, height }: { onPick: (emoji: string) => void; height: number }) {
  return (
    <EmojiPicker
      onEmojiClick={(data) => onPick(data.emoji)}
      theme={Theme.DARK}
      emojiStyle={EmojiStyle.NATIVE}
      width="100%"
      height={height}
      lazyLoadEmojis
      previewConfig={{ showPreview: false }}
      searchPlaceHolder="Search stickers"
    />
  );
}
