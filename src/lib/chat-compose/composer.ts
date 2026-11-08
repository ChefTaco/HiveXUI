// Pure composer helpers shared by every console surface that writes messages: ChatterMost chat,
// and Studio's room. Nothing here touches the DOM or a product API.

/** A slash command as the palette needs it. ChatterMost's commands carry more. */
export interface ComposerCommand {
  trigger: string;
  auto_complete_hint?: string | undefined;
}

/** Native ChatterMost's picker set, so both consoles offer the same emoji. */
export const emojiChoices = [
  "😀", "😄", "😂", "😊", "😍", "🥳", "😎", "🤔",
  "😅", "🙌", "👏", "👍", "👀", "🔥", "✨", "✅",
  "🚀", "❤️", "💜", "🎉", "🙏", "💡", "📌", "⚠️",
  "❓", "☕", "💬", "🧠", "🛠️", "📎", "📣", "🌟",
  "😮", "😢", "😡", "😴", "🤝", "👌", "👎", "🤞",
  "🧪", "🔒", "🔑", "🟢", "🟡", "🔴", "📄", "🧵",
  "🗂️", "📷", "🎧", "💻", "🧭", "📝", "🏁", "⭐",
];
const emojiKeywords: Record<string, string> = {
  "😀": "grinning smile happy",
  "😄": "smile laugh",
  "😂": "joy laugh",
  "😊": "blush happy",
  "😍": "heart eyes love",
  "🥳": "party celebration",
  "😎": "cool sunglasses",
  "🤔": "thinking",
  "😅": "sweat relief",
  "🙌": "raise hands",
  "👏": "clap applause",
  "👍": "thumbs up approve",
  "👎": "thumbs down",
  "👀": "eyes looking",
  "🔥": "fire hot",
  "✨": "sparkles",
  "✅": "check done",
  "🚀": "rocket launch",
  "❤️": "heart love",
  "💜": "purple heart",
  "🎉": "tada celebration",
  "🙏": "pray thanks",
  "💡": "idea light",
  "📌": "pin",
  "⚠️": "warning",
  "❓": "question",
  "☕": "coffee",
  "💬": "chat message",
  "🧠": "brain",
  "🛠️": "tools",
  "📎": "paperclip attach",
  "📣": "announcement",
  "🌟": "star",
  "🧪": "test lab",
  "🔒": "lock secure",
  "🔑": "key token",
  "🟢": "green online ok",
  "🟡": "yellow caution",
  "🔴": "red stop",
  "📄": "document file",
  "🧵": "thread",
  "🗂️": "folder files",
  "📷": "camera image",
  "🎧": "support audio",
  "💻": "computer",
  "🧭": "compass",
  "📝": "notes edit",
  "🏁": "finish",
  "⭐": "favorite star",
};
export type CustomEmoji = { name: string; emoji: string };

export function searchEmoji(term: string, custom: CustomEmoji[]) {
  const needle = term.trim().toLowerCase();
  return {
    standard: emojiChoices.filter(
      (emoji) =>
        !needle ||
        emoji.includes(needle) ||
        (emojiKeywords[emoji] ?? "").includes(needle),
    ),
    custom: custom.filter(
      (emoji) =>
        !needle || emoji.emoji.includes(needle) || emoji.name.includes(needle),
    ),
  };
}

const RECENT_KEY = "chattermost-recent-emoji";
const RECENT_LIMIT = 12;
export function rememberEmoji(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((value) => value !== emoji)].slice(
    0,
    RECENT_LIMIT,
  );
}
/** Recents are a convenience: blocked or corrupted storage just means an empty list. */
export function readRecentEmoji(storage: () => Storage): string[] {
  try {
    const stored: unknown = JSON.parse(storage().getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(stored)
      ? stored
          .filter((value): value is string => typeof value === "string")
          .slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function writeRecentEmoji(storage: () => Storage, recent: string[]) {
  try {
    storage().setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Recents simply last until the page closes.
  }
}

export function insertAtCaret(
  draft: string,
  start: number,
  end: number,
  text: string,
) {
  return {
    draft: draft.slice(0, start) + text + draft.slice(end),
    caret: start + text.length,
  };
}

const PALETTE_LIMIT = 8;
/** The palette is open only while the first word is being typed; arguments close it. */
export function commandSuggestions<T extends ComposerCommand>(
  commands: T[],
  draft: string,
): T[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const needle = draft.slice(1).toLowerCase();
  return commands
    .filter((command) => command.trigger.toLowerCase().startsWith(needle))
    .sort(
      (a, b) =>
        Number(b.trigger.toLowerCase() === needle) -
        Number(a.trigger.toLowerCase() === needle),
    )
    .slice(0, PALETTE_LIMIT);
}
export const completeCommand = (command: ComposerCommand) =>
  "/" + command.trigger + (command.auto_complete_hint ? " " : "");
/** Enter runs a command that is already fully typed and otherwise completes the selection. */
export const enterCompletes = (
  draft: string,
  selected: ComposerCommand | undefined,
) => !!selected && draft.slice(1).toLowerCase() !== selected.trigger.toLowerCase();
