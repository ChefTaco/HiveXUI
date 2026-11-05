// Which sidebar groups a person has opened or closed, per browser. A group nobody has touched is
// open only while it holds the current page.
export type NavChoices = Readonly<Record<string, boolean>>;
const KEY = 'hivexui-nav';

export function readNavChoices(): NavChoices {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch {
    return {};
  }
}
export function writeNavChoices(choices: NavChoices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}
export const isNavOpen = (choices: NavChoices, id: string, activeIds: readonly string[]): boolean => choices[id] ?? activeIds.includes(id);
export const toggleNavChoice = (choices: NavChoices, id: string, activeIds: readonly string[]): NavChoices => ({ ...choices, [id]: !isNavOpen(choices, id, activeIds) });
/** Arriving at a page always shows it, even in a group the person closed earlier. */
export function revealActive(choices: NavChoices, activeIds: readonly string[]): NavChoices {
  if (!activeIds.some((id) => choices[id] === false)) return choices;
  return Object.fromEntries(Object.entries(choices).filter(([id, open]) => open || !activeIds.includes(id)));
}
