import { describe, expect, it } from "vitest";
import type { MattermostCommand } from "../../../contracts/chattermost.generated";
import {
  commandSuggestions,
  completeCommand,
  enterCompletes,
  emojiChoices,
  insertAtCaret,
  readRecentEmoji,
  rememberEmoji,
  searchEmoji,
  writeRecentEmoji,
} from "./composer";

const command = (trigger: string, hint = "") =>
  ({ id: trigger, trigger, auto_complete_hint: hint, description: trigger }) as MattermostCommand;
const commands = ["reset", "resume", "reload-skills", "help", "status"].map((t) =>
  command(t),
);

describe("emoji search", () => {
  it("finds standard emoji by keyword and custom emoji by name", () => {
    const found = searchEmoji("ROCK", [{ name: "rockhopper", emoji: "🐧" }]);
    expect(found.standard).toEqual(["🚀"]);
    expect(found.custom.map((value) => value.name)).toEqual(["rockhopper"]);
  });
  it("shows everything for an empty term", () => {
    expect(searchEmoji("  ", []).standard).toEqual(emojiChoices);
  });
});

describe("recent emoji", () => {
  it("keeps the newest first without duplicates, up to twelve", () => {
    expect(rememberEmoji(["🔥", "🚀"], "🚀")).toEqual(["🚀", "🔥"]);
    expect(
      rememberEmoji(emojiChoices.slice(0, 12), "⭐"),
    ).toHaveLength(12);
  });
  it("survives corrupt and blocked storage", () => {
    const corrupt = () => ({ getItem: () => "{not json" }) as unknown as Storage;
    const blocked = (): Storage => {
      throw new Error("denied");
    };
    expect(readRecentEmoji(corrupt)).toEqual([]);
    expect(readRecentEmoji(blocked)).toEqual([]);
    expect(() => writeRecentEmoji(blocked, ["🔥"])).not.toThrow();
  });
  it("ignores stored values that are not strings", () => {
    const mixed = () =>
      ({ getItem: () => JSON.stringify(["🔥", 7, null]) }) as unknown as Storage;
    expect(readRecentEmoji(mixed)).toEqual(["🔥"]);
  });
});

it("inserts at the caret and replaces a selection", () => {
  expect(insertAtCaret("hello", 5, 5, "🔥")).toEqual({
    draft: "hello🔥",
    caret: 7,
  });
  expect(insertAtCaret("hello", 1, 4, "🔥").draft).toBe("h🔥o");
});

describe("slash command palette", () => {
  it("filters by the typed prefix", () => {
    expect(commandSuggestions(commands, "/re").map((c) => c.trigger)).toEqual([
      "reset",
      "resume",
      "reload-skills",
    ]);
    expect(commandSuggestions(commands, "/").length).toBe(5);
  });
  it("closes on arguments and outside a command", () => {
    expect(commandSuggestions(commands, "/help me")).toEqual([]);
    expect(commandSuggestions(commands, "hi /help")).toEqual([]);
    expect(commandSuggestions(commands, "")).toEqual([]);
  });
  it("offers at most eight", () => {
    const many = Array.from({ length: 20 }, (_, index) => command("c" + index));
    expect(commandSuggestions(many, "/c")).toHaveLength(8);
  });
  it("puts an exact match first so Enter runs it", () => {
    const list = [command("resets"), command("reset")];
    const found = commandSuggestions(list, "/reset");
    expect(found[0]!.trigger).toBe("reset");
    expect(enterCompletes("/reset", found[0])).toBe(false);
  });
  it("completes a partial word with Enter", () => {
    expect(enterCompletes("/he", command("help"))).toBe(true);
    expect(enterCompletes("hello", undefined)).toBe(false);
  });
  it("leaves room for arguments only when the command takes them", () => {
    expect(completeCommand(command("model", "[provider:model]"))).toBe("/model ");
    expect(completeCommand(command("status"))).toBe("/status");
  });
});
