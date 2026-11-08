# HiveXUI theme

HiveXUI is the single console for Hive:Magnus products, so every page shares one set of
tokens and components. This is how a page, new or ported, adopts them.

There is one theme for now: the Magnus look. Near-black surfaces, neon cyan and magenta,
saturated status colors that glow, a faint grid, terminal breadcrumbs, and display headings in
uppercase mono. `tokens.css` has a single `:root` block, the console sets `color-scheme: dark`,
and nothing follows the operating system or reads a stored preference. Body text stays in the
sans and meets WCAG AA: drama belongs in headings, status, data and focal widgets, not paragraphs.

Tokens stay semantic so a light theme can come back without touching components: colors are named
for what they mean, and the look of headings, labels, navigation and controls is itself a set of
tokens (`--heading-*`, `--panel-title-*`, `--label-*`, `--nav-*`, `--control-*`, `--data-font`,
`--glow-text-strength`, `--glow-mark-radius`, `--backdrop-*`). To add a theme, add a second token
block, a way to choose it, and its contrast run in `tokens.test.ts`; `theme-guard.test.ts` forbids
theme switches until then, so remove that check with it.

## Where things live

| What | Where |
| --- | --- |
| Tokens, Tailwind theme mapping | `src/styles/tokens.css` |
| Layer order and imports | `src/styles/index.css` |
| Element defaults: links, form controls, tables | `src/styles/base.css` |
| Shared component classes and the console shell | `src/styles/app.css` |
| Shared React components | `src/components/ui.tsx`, imported as `@ui` |
| Focal widgets | `src/components/gauge.tsx`, `radar.tsx`, `sparkline.tsx`, `tones.ts` |
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
4. Check the page at desktop and phone width. Canvas and chart code that cannot use CSS reads
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
| Signal | `text-signal`, `bg-signal text-on-signal`, `bg-signal-soft` |
| Status | `text-success`, `bg-success-soft`, `bg-success text-on-success`; same for `warning`, `danger`, `info` |
| Persona | `fill-persona-1` to `fill-persona-6` (and `stroke-`, `border-`): identity colors for agent portraits, never a status |
| Type | `text-xs` (12px, captions and labels), `text-sm` (13), `text-base` (14, default), `text-lg` (16), `text-xl` (18), `text-2xl` (22), `text-3xl` (28) |
| Fonts | `font-sans` (default), `font-display` (headings), `font-mono` (code and identifiers) |
| Radii | `rounded-chip`, `rounded-control`, `rounded-panel`, `rounded-dialog`, `rounded-pill` |
| Spacing | The normal scale; `p-4` equals `--space-4` |
| Numbers | `num` for tabular figures |
| Motion | `duration-[var(--duration-base)]`, `ease-standard`, `ease-out-expo`, `animate-halo`, `animate-shimmer`, `animate-glow-pulse`, `animate-flicker`, `animate-sweep`, `animate-ticker`, `animate-toast-in`, `animate-page-in` |
| Glow | `glow-accent`, `glow-signal`, `glow-success`, `glow-warning`, `glow-danger`, `glow-info`, `glow-text-*`, `glow-hover`, `shadow-glow-sm`, `shadow-glow-md`, `shadow-[0_0_8px_var(--color-glow-danger)]` |
| Backdrops | `panel-corners`, `grid-bg`, `scan-sweep`. Every `Panel` already has corner brackets |
| Voice | `stat-label` for a short label, `data-figure` for a figure in the data font, `eyebrow` above a title |
| Activity | `typing-dots` around three empty spans, always beside text saying what is happening |
| SVG scenes | `fx-screen-glow` for a lit shape, `fx-dash-flow` for dashes moving along a path; both stop under `data-fx='low'` |

`primary` is an alias of `accent` kept for ported pages; prefer `accent` in new code. Tailwind's
default palette is removed, so `bg-red-500` produces nothing. There are no `dark:` variants.

## Motion and effects

Motion and glow are part of the product and stay when a page is ported. Tokens live in
`tokens.css`: `--duration-fast|base|slow|sweep`, `--ease-standard`, `--ease-out-expo`, and
`--glow-accent|signal|success|warning|danger|info`. Reusable hooks live in `effects.css`; add
new effects there, built from these tokens. `Panel glow="success"` adds a hover glow. For a
marquee, duplicate the content once inside an `animate-ticker` track.

`prefers-reduced-motion` stops every animation and transition, and `html[data-fx='low']`
stops looping effects, so show nothing important only through motion. Glow is decoration:
pair it with text or a status color. Keep effects to focal widgets, status and data; forms and
dense tables get none beyond the shared hover and focus states.

## Stat tiles and overviews

`StatCard` is a figure in its tone over a footer that fades from the same tone. Pass
`footer={<TileTrend values={...} tone="accent" />}` when there is a series, or `footer={false}`
for a tile that carries a `Meter` as its child; `useSessionSamples` keeps a series for trends the
API has no history for. Use `neutral` when the figure needs no attention, such as zero critical
cases, so color still means something. A product's overview page leads with a focal band: a
`Panel` with `grid-bg` around a `hero-row` of `Radar`, `Gauge` and a `hero-trend`, all from real
data. See `modules/suite`, `pages/routers.tsx` and the Cindertrace overview.

## Shell

The top bar's `<h1>` is the last crumb of the terminal breadcrumb, and the page shows its display
title in `PageHeader` or `page-head`. Do not add another title. A page owns its Refresh: the shell
shows one only for pages listed in `showsShellRefresh` in `lib/navigation.ts`, which read the shared
store and have none of their own. The sidebar groups pages by product through `navProducts`; only
the current product is open until someone opens another, and that choice is remembered in the
browser. `Ctrl` or `Cmd` + `K` searches every screen the session can see.

## Narrow screens

Multi-column layouts collapse by themselves below 640px: `form-grid`, `field-grid`,
`page-grid--2`, and unprefixed `grid-cols-3` or more. Below 920px, children of the content
area may shrink below their content, and a table outside `TableFrame` scrolls on its own, so
the page itself does not scroll sideways. Put wide tables in `TableFrame`. Fixed widths
(`w-[40rem]`, `min-w-[...]` outside a table) can still overflow; the walkthrough reports it.

## Meaning of color

`accent` means primary action, selection, link and focus. It does not mean success. `signal` is
the second brand color for active data and the marks of the shell, never a status. Use `success`,
`warning`, `danger` and `info` only for status. For a label with no status, use a neutral badge,
which also keeps its case, so names read as written.

## Porting from the Magnus console

| Magnus | HiveXUI |
| --- | --- |
| `text-[9px]`, `text-[10px]`, `text-[11px]` | `text-xs`; `text-sm` if it is reading text |
| `text-xs` on body copy | `text-sm` |
| `uppercase`, `tracking-*` | Remove: shared components speak through the voice tokens. For a short label above a title, use `eyebrow` on `PageHeader` or `Panel`; elsewhere, `stat-label` |
| `glow-*`, `panel-corners`, `grid-bg`, `animate-*`, `shadow-[0_0_...var(--color-glow)]` | Keep; they resolve to theme tokens |
| `neon-text`, `neon-border`, `accent-glow` | `glow-text-primary`, `glow-accent` |
| `glitch`, scanlines and other effects not listed above | Add to `effects.css` from tokens, for design review |
| `GlowPanel`, `Card` | `Panel` (`glow=` for the hover glow, `panel-corners` for brackets) |
| `Badge variant=` | `Badge tone=` with `statusTone()` for status strings |
| `MeterBar` | `Meter` |
| `Modal` | `ConfirmDialog` or `Drawer` |
| `text-accent` as a second brand color | `text-signal`; a status color if it meant one |
| `bg-black`, `bg-white`, `text-white` | `bg-surface-sunken`, `bg-surface-raised`, `text-on-accent` |
| Own `<h1>` | `PageHeader`, which renders `<h2>`; the top bar owns the `<h1>` |

## Do not

- Add a color, font or font size anywhere but `tokens.css`, including arbitrary values and inline styles.
- Use text under 12px. Do not put a sentence in an `eyebrow` or a stat label: they render in capitals.
- Hardcode a glow color or a duration; use the tokens.
- Name a class after a Tailwind utility (`grid`, `table`, `flex`). The utility would then bring that class's other declarations with it.
- Give a shared component an outer margin. Parents space children with `gap`; `page-stack` and `page-grid` are there for it.
- Leave a `<button>` without a class. Preflight strips its appearance; use `Button` or `btn`.
- Add a theme switch, a `dark:` variant or a query on the operating system's color scheme. There is one theme for now.
- Use a color pair that fails WCAG AA. `tokens.test.ts` checks this; add new pairs there.
