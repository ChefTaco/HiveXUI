/** The `@name` mentions in a message, lowercased and without the `@`. */
export function mentionedNames(message: string): Set<string> {
  return new Set((message.toLowerCase().match(/@[a-z0-9._-]+/g) ?? []).map((mention) => mention.slice(1)));
}

/** The `@partial` mention being typed right before the caret, with where it starts; null when none is. */
export function mentionAtCaret(draft: string, caret: number): { start: number; query: string } | null {
  const match = /(^|[\s(,;])@([a-z0-9._-]{0,48})$/i.exec(draft.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]!.toLowerCase() };
}

/** Replaces the mention being typed with `@name ` and returns the caret after it. */
export function completeMention(draft: string, caret: number, start: number, name: string): { draft: string; caret: number } {
  const text = `@${name} `;
  const after = draft.slice(caret).replace(/^[a-z0-9._-]*/i, '');
  return { draft: draft.slice(0, start) + text + after.replace(/^ /, ''), caret: start + text.length };
}
