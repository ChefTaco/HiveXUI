/** The `@name` mentions in a message, lowercased and without the `@`. */
export function mentionedNames(message: string): Set<string> {
  return new Set((message.toLowerCase().match(/@[a-z0-9._-]+/g) ?? []).map((mention) => mention.slice(1)));
}
