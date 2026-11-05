/** Resolved token colors for canvas and chart code, which cannot use CSS variables or classes. */
const TOKENS = ['surface-page', 'surface', 'border', 'text', 'text-muted', 'accent', 'signal', 'success', 'warning', 'danger', 'info'] as const;
export type ThemeColors = Record<(typeof TOKENS)[number], string>;

export function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(TOKENS.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])) as ThemeColors;
}
