import { Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MattermostCommand } from "../../../contracts/chattermost.generated";
import { IconButton, TextInput } from "@ui";
import { cn } from "@lib/cn";
import {
  rememberEmoji,
  readRecentEmoji,
  searchEmoji,
  writeRecentEmoji,
  type CustomEmoji,
} from "./composer";

const storage = () => localStorage;

function EmojiGrid({
  emoji,
  pick,
}: {
  emoji: { symbol: string; label: string }[];
  pick: (symbol: string) => void;
}) {
  return (
    <div className="chat-emoji-grid">
      {emoji.map(({ symbol, label }) => (
        <button
          key={symbol}
          className="chat-emoji-choice"
          type="button"
          title={label}
          aria-label={"Add emoji " + label}
          onClick={() => pick(symbol)}
        >
          {symbol}
        </button>
      ))}
    </div>
  );
}

export function EmojiPicker({
  custom,
  disabled,
  insert,
}: {
  custom: CustomEmoji[];
  disabled: boolean;
  insert: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [term, setTerm] = useState(""),
    [recent, setRecent] = useState(() => readRecentEmoji(storage));
  const root = useRef<HTMLDivElement>(null);
  function close() {
    setOpen(false);
    setTerm("");
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  function pick(emoji: string) {
    const next = rememberEmoji(recent, emoji);
    setRecent(next);
    writeRecentEmoji(storage, next);
    close();
    insert(emoji);
  }
  const matches = searchEmoji(term, custom);
  const known = (symbol: string) =>
    matches.standard.includes(symbol) ||
    matches.custom.some((value) => value.emoji === symbol);
  const recents = term ? [] : recent.filter(known);
  const standard = (symbol: string) => ({ symbol, label: symbol });
  return (
    <div className="chat-emoji-picker" ref={root}>
      <IconButton
        label="Emoji"
        icon={<Smile />}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open ? (
        <div
          className="chat-emoji-popover"
          role="dialog"
          aria-label="Emoji picker"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            close();
            root.current?.querySelector("button")?.focus();
          }}
        >
          <TextInput
            aria-label="Search emoji"
            placeholder="Search"
            autoComplete="off"
            autoFocus
            value={term}
            onChange={setTerm}
            onKeyDown={(event) => {
              // A search field inside the composer form must not send the message.
              if (event.key === "Enter") event.preventDefault();
            }}
          />
          {recents.length ? (
            <section aria-label="Recent emoji">
              <h4>Recent</h4>
              <EmojiGrid emoji={recents.map(standard)} pick={pick} />
            </section>
          ) : null}
          <section aria-label={term ? "Matching emoji" : "Common emoji"}>
            <h4>{term ? "Matches" : "Common"}</h4>
            {matches.standard.length ? (
              <EmojiGrid emoji={matches.standard.map(standard)} pick={pick} />
            ) : (
              <p>No emoji found.</p>
            )}
          </section>
          {matches.custom.length ? (
            <section aria-label="Custom emoji">
              <h4>Custom</h4>
              <EmojiGrid
                emoji={matches.custom.map(({ emoji, name }) => ({
                  symbol: emoji,
                  label: ":" + name + ":",
                }))}
                pick={pick}
              />
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const commandOptionId = (index: number) =>
  "chat-command-option-" + index;
export function CommandPalette({
  id,
  suggestions,
  index,
  pick,
}: {
  id: string;
  suggestions: MattermostCommand[];
  index: number;
  pick: (command: MattermostCommand) => void;
}) {
  return (
    <div
      id={id}
      className="chat-command-palette"
      role="listbox"
      aria-label="Slash commands"
    >
      <p>Tab completes · Enter runs · Esc closes</p>
      {suggestions.map((command, position) => (
        <button
          key={command.id || command.trigger}
          id={commandOptionId(position)}
          className={cn(
            "chat-command-option",
            position === index && "chat-command-option--active",
          )}
          type="button"
          role="option"
          aria-selected={position === index}
          tabIndex={-1}
          // Keep the caret in the composer while choosing with the mouse.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(command)}
        >
          <code>
            /{command.trigger}
            {command.auto_complete_hint ? " " + command.auto_complete_hint : ""}
          </code>
          <span>{command.auto_complete_desc || command.description}</span>
        </button>
      ))}
    </div>
  );
}
