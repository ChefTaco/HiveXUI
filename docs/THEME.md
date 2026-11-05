# HiveXUI theme

HiveXUI is the single console for Hive:Magnus products, so every page shares one set of
tokens and components. This is how a page, new or ported, adopts them.

## Where things live

| What | Where |
| --- | --- |
| Tokens (light and dark), Tailwind theme mapping | `src/styles/tokens.css` |
| Layer order and imports | `src/styles/index.css` |
| Element defaults: links, form controls, tables | `src/styles/base.css` |
| Shared component classes and the console shell | `src/styles/app.css` |
| Shared React components | `src/components/ui.tsx`, imported as `@ui` |
| Guard tests | `src/styles/tokens.test.ts`, `src/styles/theme-guard.test.ts` |

Styles load in the layers `theme, base, components, utilities`. A Tailwind utility always
beats a component class or an element default, regardless of import order or specificity.

## Porting a module

1. Move the pages under `src/modules/<name>/`. Tailwind scans all of `src/`, so no
   `@source` or Tailwind import is needed. Do not import `tailwindcss` anywhere else.
2. Replace the module's own primitives with the ones in `@ui`:
   `Button`, `IconButton`, `Badge`, `Panel`, `PageHeader`, `EmptyState`, `TableFrame`,
   `Field`, `TextInput`, `Select`, `Toggle`, `StatCard`, `StatusDot`, `Meter`, `Skeleton`,
   `Drawer`, `ConfirmDialog`. Use `cn` from `@lib/cn` to merge classes.
3. Remove what the theme no longer supports (table below), then run `npm test`. The guard
   tests list each remaining violation by file.
4. Check the page in light and dark. Canvas and chart code that cannot use CSS reads
   resolved colors with `readThemeColors` from `@lib/theme-colors`.

If a module truly needs its own CSS, wrap the whole file in `@layer components { ... }`,
use only tokens, and limit it to layout. Unlayered CSS would beat every utility.

## Tailwind classes

| Purpose | Classes |
| --- | --- |
| Backgrounds | `bg-bg`, `bg-surface`, `bg-surface-raised`, `bg-surface-sunken`, `bg-surface-hover` |
| Text | `text-text`, `text-text-strong`, `text-text-muted` |
| Borders | `border-border`, `border-border-strong` |
| Accent | `text-accent`, `bg-accent text-on-accent`, `bg-accent-soft`, `hover:bg-accent-hover` |
| Status | `text-success`, `bg-success-soft`, `bg-success text-on-success`; same for `warning`, `danger`, `info` |
| Type | `text-xs` (12px, captions and labels), `text-sm` (13), `text-base` (14, default), `text-lg` (16), `text-xl` (18), `text-2xl` (22), `text-3xl` (28) |
| Fonts | `font-sans` (default), `font-display` (headings), `font-mono` (code and identifiers) |
| Radii | `rounded-chip`, `rounded-control`, `rounded-panel`, `rounded-dialog`, `rounded-pill` |
| Spacing | The normal scale; `p-4` equals `--space-4` |
| Numbers | `num` for tabular figures |
| Motion | `duration-[var(--duration-base)]`, `ease-standard`, `ease-out-expo`, `animate-halo`, `animate-shimmer`, `animate-glow-pulse`, `animate-flicker`, `animate-sweep`, `animate-ticker`, `animate-toast-in`, `animate-page-in` |
| Glow | `glow-accent`, `glow-success`, `glow-warning`, `glow-danger`, `glow-info`, `glow-text-*`, `glow-hover`, `shadow-glow-sm`, `shadow-glow-md`, `shadow-[0_0_8px_var(--color-glow-danger)]` |
| Backdrops | `panel-corners`, `grid-bg`, `scan-sweep` |
| Activity | `typing-dots` around three empty spans, always beside text saying what is happening |

`dark:` follows the console's theme control, but tokens already change with the theme, so
a page rarely needs it. `primary` is an alias of `accent` kept for ported pages; prefer
`accent` in new code. Tailwind's default palette is removed, so `bg-red-500` produces
nothing.

## Motion and effects

Motion and glow are part of the product and stay when a page is ported. Tokens live in
`tokens.css`: `--duration-fast|base|slow|sweep`, `--ease-standard`, `--ease-out-expo`, and
`--glow-accent|success|warning|danger|info`, which differ per theme. Reusable hooks live in
`effects.css`; add new effects there, built from these tokens. `Panel glow="success"` adds a
hover glow. For a marquee, duplicate the content once inside an `animate-ticker` track.

`prefers-reduced-motion` stops every animation and transition, and `html[data-fx='low']`
stops looping effects, so show nothing important only through motion. Glow is decoration:
pair it with text or a status color. The final look of ported effects is settled in a design
review after the port.

## Narrow screens

Multi-column layouts collapse by themselves below 640px: `form-grid`, `field-grid`,
`page-grid--2`, and unprefixed `grid-cols-3` or more. Below 920px, children of the content
area may shrink below their content, and a table outside `TableFrame` scrolls on its own, so
the page itself does not scroll sideways. Put wide tables in `TableFrame`. Fixed widths
(`w-[40rem]`, `min-w-[...]` outside a table) can still overflow; the walkthrough reports it.

## Meaning of color

Teal `accent` means primary action, selection, link and focus. It does not mean success.
Use `success`, `warning`, `danger` and `info` only for status. For a label with no status,
use a neutral badge. Do not use color for decoration or to tell categories apart.

## Porting from the Magnus console

| Magnus | HiveXUI |
| --- | --- |
| `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-xs`; `text-sm` if it is reading text |
| `text-xs` on body copy | `text-sm` |
| `uppercase`, `tracking-*` | Remove. For a short label above a title, use `eyebrow` on `PageHeader` or `Panel` |
| `glow-*`, `panel-corners`, `grid-bg`, `animate-*`, `shadow-[0_0_...var(--color-glow)]` | Keep; they resolve to theme tokens |
| `neon-text`, `neon-border`, `accent-glow` | `glow-text-primary`, `glow-accent` |
| `glitch`, scanlines and other effects not listed above | Add to `effects.css` from tokens, for design review |
| `GlowPanel`, `Card` | `Panel` (`glow=` for the hover glow, `panel-corners` for brackets) |
| `Badge variant=` | `Badge tone=` with `statusTone()` for status strings |
| `MeterBar` | `Meter` |
| `Modal` | `ConfirmDialog` or `Drawer` |
| `text-accent` as a second brand color | `text-accent` is now teal; use a status color if it meant one |
| `bg-black`, `bg-white`, `text-white` | `bg-surface-sunken`, `bg-surface-raised`, `text-on-accent` |
| Own `<h1>` | `PageHeader`, which renders `<h2>`; the top bar owns the `<h1>` |

## Do not

- Add a color, font or font size anywhere but `tokens.css`, including arbitrary values and inline styles.
- Use text under 12px, all-caps sentences or wide letter spacing.
- Hardcode a glow color or a duration; use the tokens.
- Name a class after a Tailwind utility (`grid`, `table`, `flex`). The utility would then bring that class's other declarations with it.
- Give a shared component an outer margin. Parents space children with `gap`; `page-stack` and `page-grid` are there for it.
- Leave a `<button>` without a class. Preflight strips its appearance; use `Button` or `btn`.
- Add a token without defining it in both themes, or use a color pair that fails WCAG AA. `tokens.test.ts` checks this; add new pairs there.
