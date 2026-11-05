# Porting a Magnus console page

The old console is `apps/dashboard` in the Magnus repository, a Next.js app. It is read-only. A page
moves here in the same shape, with its look and motion, on HiveXUI's shared theme. Read
`docs/THEME.md` first.

## Your work package

Touch only your package's files. Then several agents can work at once with no conflicts.

| Package | Route file | Page directories | Old paths |
| --- | --- | --- | --- |
| `fleet` | `routes/fleet.ts` | `pages/fleet/` | `/application-operations` `/fleet-readiness` `/fleet-map` `/anomalies` `/anomalies/[anomalyId]` `/anomalies/remediation` `/notifications` `/nodes/[nodeId]`, and the Upgrade Agents action on `/nodes` (`components/nodes/agent-upgrade-modal.tsx`, `?upgrade=agents`), not yet ported |
| `operations` | `routes/operations.ts` | `pages/operations/` | `/commands` `/logs` `/audit` `/cron` `/files` `/incidents` `/rollouts` `/governor/operations` `/webhooks` `/webhooks/new` `/webhooks/[id]` `/api-docs` |
| `provisioning` | `routes/provisioning.ts` | `pages/provisioning/` | `/roles` `/library` `/skills` |
| `agents` | `routes/agents.ts` | `pages/agents/` | `/orchestra` `/orchestra/installations` `/orchestra/profiles` `/hermes-drift` `/hermes-security` `/ardent` `/ardent/installations` `/ardent/profiles` `/ardent/profiles/[id]` `/codex` `/codex/installations` |

Each package also owns `routes/<package>.provenance.json`. Do not edit `nav.ts`, `effects/`, `api/`,
`navigation.tsx`, `index.tsx`, `src/app.tsx` or anything in `src/lib`. If you need a change there, say so in
your report. Do not add a dependency: if you truly need one, say so too.

Not ported, by the owner's decision. Leave them out and remove any link to them:

- `/login`. Sign-in is Oathweave.
- `/security-fusion/*`. Cindertrace is in HiveXUI. A link to it stays as it is and works.
- `components/control-nodes`, `control-node-bar`, `api/federation`, `x-proxy-target`, federation modes. There
  is one API per installation.
- `/orchestra/web-gateway` and the embedded Hermes dashboard. Nothing from a node is embedded.
- The registry parts of `/skills`. HiveSkills is the only registry. Keep only per-node installed Skills.
- Terminal controls, including `terminal-modal`. The web terminal comes later through its own gateway.
- `/governor/share/[token]`. Ask the owner first.

## The recipe

Say you are porting `/rollouts`, in the `operations` package.

1. Read the old page, its client component and everything it imports from `components/`. Read the shapes in
   `contracts/magnus/browser.ts`, whose comment lines name the server source of each one. Check the method and
   path against `docs/console-api.md` in Magnus. A route marked `machine` or `exclude` is not offered: drop
   that feature and say so in your report.
2. Create `pages/operations/rollouts/page.tsx` with a default export and no props. Keep a page's own components
   and helpers beside it.
3. Register it in `routes/operations.ts`. It appears in the sidebar by itself, because its path is already in
   `nav.ts`.

   ```ts
   { path: '/rollouts', title: 'Guided Rollouts', load: () => import('../pages/operations/rollouts/page') },
   ```

   Use `:name` for a parameter: `/webhooks/:id`. Add `roles: ['ADMIN']` or `capability: 'hermes'` if the whole page
   is limited. Write roles out as literals here, because route files load with the main chunk and must import
   nothing from `session` or the contract. Everything under `/orchestra`, `/hermes-drift` and `/hermes-security`
   takes `capability: 'hermes'`.
4. Replace the imports, using the table below.
5. Replace the data calls. `fleetFetch` and server components become `useMagnusResource`. Every call names its
   schema, so the response is checked and its unknown keys are stripped:

   ```tsx
   import { rolloutListResponseSchema, rolloutActionResponseSchema } from '@contracts/magnus/browser';
   import { magnus, segment } from '../../../api/client';
   import { useMagnusResource } from '../../../api/use-resource';

   const rollouts = useMagnusResource((signal) => magnus.get('/rollouts', rolloutListResponseSchema, { signal }), [], { pollMs: 15_000 });
   // rollouts.data?.data, rollouts.loading, rollouts.error, rollouts.refresh()

   await magnus.post(`/rollouts/${segment(id)}/pause`, rolloutActionResponseSchema);
   ```

   Paths are relative to `/api/v1`. Encode every value in a path with `segment`. A body goes in `{ body }` and a
   query in `{ query }`. `POST /commands` needs `{ idempotencyKey: idempotencyKey() }`.

   A route with no contract: write a zod schema in the page's directory, in a file named `schemas.ts`, say so in
   your report, and leave `contracts/magnus` alone. It is a verified copy.
6. Hide what the role cannot do. Each route in `magnusBrowserRoutes` lists its `roles`. Use exactly those:

   ```tsx
   import { ADMIN_ONLY, RequireRole, RequireHermes, useMagnusSession, WRITE_ROLES } from '../../../session';
   const { can, hermes, session } = useMagnusSession();
   <RequireRole roles={WRITE_ROLES}><Button>Pause</Button></RequireRole>
   ```

   Hide Hermes sections with `hermes` or `RequireHermes`, and do not request `/hermes/*` or `/orchestra/*` when it
   is false: `useMagnusResource(load, [], { enabled: hermes })`.
   `session.capabilities.agentVersion` and `magnusVersion` replace build-time values.
7. Keep the look. See "Effects" below: port every animation and marquee the old page had, and do not flatten it.
8. Add a test beside the page for any logic you moved: parsing a JSON column, a calculation, a decision.
9. Record the sources:

   ```bash
   npm run magnus:provenance -- operations <magnus clone> apps/dashboard/src/app/rollouts/page.tsx
   ```
10. Check it, in this order:

    ```bash
    npm run typecheck && npm test && npm run build && npm run check:contracts && npm run scan:secrets && npm run check:private
    ```

    Then run the walkthrough against the real stack and read every screenshot yourself, in both themes and at
    phone width. A green harness is not acceptance. An empty fleet still has to look right.

## What replaces what

| Old | Here |
| --- | --- |
| `next/link` | `import Link from '../../../navigation'`. `href` stays console-relative: `/nodes`. |
| `next/navigation` | `usePathname`, `useSearchParams`, `useParams`, `useRouter`, `notFound`, `redirect` from `navigation`. Paths are console-relative, and `usePathname` gives `/nodes`, never `/fleet/nodes`. |
| `next/dynamic` | `React.lazy`, as in `effects/charts/lazy-area-chart.tsx`. |
| A link to a page that may not be ported yet | Wrap it in `hasRoute('/rollouts')` from `routes`. It appears on its own once the page is. |
| An `href` from API data | `Link` handles it. It maps the path under `/fleet` and renders plain text for anything unsafe. For your own markup, use `toFleetHref`. |
| `ky`, `lib/api-client.ts`, `fleetFetch`, `orchestraFetch` | `magnus` from `api/client`. |
| `api.getAuthHeaders()`, a hand-written fetch stream, `EventSource` | `openStream` from `api/stream`, below. |
| `use-event-stream`, `eventFeed` | `useEventFeed` from `live/use-live-events`. The module already holds the one connection. |
| `useToast` from `components/ui/toast-provider` | `useToast` from `src/components/toast`: `toast.success(title, message)`, `toast.error`, `toast.info`. |
| `confirm()` | `ConfirmDialog` from `@ui`. |
| `Modal` with a form | `Drawer` from `@ui`, or a page-level form. |
| `Card`, `GlowPanel` | `FxPanel` from `effects`, which is the shared `Panel` plus the effects. |
| `Badge variant=`, `statusVariant` | `Badge tone=`, `statusTone` from `@ui`. |
| `StatusDot`, `Button`, `PageHeader`, `EmptyState`, `Skeleton` | From `@ui`. The props differ: `description` on `EmptyState` is `message`; `Button variant="secondary"` is the default. |
| `MeterBar` | `FxMeter` from `effects`. |
| `Gauge`, `Sparkline`, `AnimatedNumber`, `FleetRadar`, `LazyAreaChart`, `useSessionSamples` | The same names from `effects`. Chart tones are `accent`, `info`, `success`, `warning`, `danger`, `neutral`. `primary` becomes `accent`, and `accent` becomes `info`. |
| `PageTransition` / `PageItem` | Drop `PageTransition` for `<div className="page-stack">`. `PageItem` is in `effects`. |
| `NodeSelector` | `ui/node-selector` (single select; call it for each node if the old page was multi). |
| `SkeletonTable`, `SkeletonText`, an inline error state | `LoadingRows` and `ResourceError` from `ui/resource-state`. |
| `formatDate`, `formatBytes` | `formatTime`, `relativeTime` from `@lib/format`. Write `formatBytes` beside the page if you need it. |
| `<h1>`, `text-[10px]`, `uppercase`, `tracking-*`, `bg-black` | Per `docs/THEME.md`. It covers what the guard tests enforce. |

## Effects

The owner asked to keep the visually impressive parts of the old console. Do not flatten a page, and do not
reimplement an effect. Use what exists, driven by real data, in theme colors. Shared hooks are in
`src/styles/effects.css` and `tokens.css`, the module's own in `effects/`:

| Old | Here | Use for |
| --- | --- | --- |
| `animate-ticker`, `HeaderTicker` | `Ticker` | A marquee of real items. Already above every page in `live/live-band`. |
| `LiveEventList` | `live/live-list` | A panel of fleet events. |
| `FleetRadar`, `animate-sweep` | `FleetRadar`; `fx-radar` with `animate-sweep` for your own | A rotating sweep over real blips. |
| Gauge glow | `Gauge` | Hero figures. |
| `GlowPanel` | `FxPanel`, with `hero`, `fxTone`, `interactive={false}` | Every panel. It is the shared `Panel` plus `panel-corners`, `glow-hover` and `grid-bg`. |
| `glow-hover`, `panel-corners`, `grid-bg` | The same classes | A tile or link: see `QuickLinks` in Mission Control. |
| `glow-text-*` | The same classes, or `GLOW_TEXT[tone]` | A figure that matters, beside a status or accent text color. |
| `neon-text`, `neon-border`, `accent-glow` | `glow-text-primary`, `glow-accent` | |
| `MeterBar` glow | `FxMeter` | Lights by itself past the warning threshold. |
| `animate-page-in` | `PageItem` | Each block of a page. |
| `scan-sweep` | The same class | A row as it arrives. Keying a row on its status makes it sweep again when the status changes. |
| `animate-halo`, `animate-pulse` on a dot | `HaloDot`, `animate-halo`, `fx-pulse`, `Badge dot` with `fx-badge-pulse` | A live or failing state. The shared `StatusDot` already pulses for live states. |
| Hover rail on a table row | `fx-rail` on the `<tr>` | Table rows. |
| Bus line between stations | `fx-bus` | See `SystemBus` in Mission Control. |
| `ScanAnimation` and its scan line | `ScanPanel`, `fx-scanline` | Fleet scans. `/cron` and `/skills` use it. |
| `glitch` | `fx-glitch` | Error and not-found states. The module's own already use it. |
| `cursor-blink`, `animate-flicker`, `draw-stroke` | `fx-cursor`, `animate-flicker`, `fx-draw` | Small signals. |
| `motion/react` | CSS. Do not add `motion`. | |
| Fleet map's canvas | Port it to `pages/fleet/fleet-map/`. Read colors with `readThemeColors` from `@lib/theme-colors` and stop its frame loop when `useReducedMotion()` is true. | Fleet package. |

Effects of the old console not used by a page yet, and who has them:

| Effect | Status |
| --- | --- |
| Fleet map canvas | Fleet package. |
| Sidebar hover sheen and spring indicator, breadcrumb cursor | The shell is shared. Left for the design review. |
| Toast slide-in and progress bar | `src/components/toast` is shared. Left for the design review. |
| Command palette | Not ported; no package owns it yet. |
| `text-glow`, `glow-pulse`, `scanline-scroll`, `neon-border`, `accent-glow` | Defined in the old CSS, used by nothing there. |

Rules for anything you add to a page:

- Render a `Drawer` or `ConfirmDialog` outside any element with a transform, filter or running animation, or it
  will be positioned inside that element. `PageItem` is safe once its arrival has finished; `nodes/page.tsx` shows
  the usual shape, with them last in the page.
- CSS animation is fine and costs nothing. A timer or a request exists only to refresh real data, never for a
  visual. `useMagnusResource` with `pollMs` is the way to poll. The walkthrough waits for the network to be quiet, so
  a request made for looks would hang it.
- Anything driven by script checks `useReducedMotion()`. CSS is switched off for you by `styles/base.css`.
- Use theme tokens only. For SVG attributes, use `TONE_COLOR` from `effects`.
- Use theme tokens for glows and durations: `--glow-accent`, `--duration-slow` and so on.
- An effect that two pages need belongs in `effects/`. Ask in your report rather than editing it.

## Streams and rate limits

`EventSource` cannot send the bearer token, so read a stream with `openStream`:

```ts
const stream = openStream({ path: '/logs/stream', query: { levels: 'error' }, onEvent: ({ event, data }) => { /* JSON.parse(data) */ }, onState: setState });
// stream.close() in the effect's cleanup
```

It reconnects with a fresh token, backs off, stops on logout and gives up on 403 and 404. Only open a stream after an
operator's action, such as a Live button, or after `STREAM_DWELL_MS` as `live/use-live-events` does: the walkthrough
counts an open `fetch` as pending, and the page would never settle.

The server allows each subject 20 `/hermes/*` and 30 `/orchestra/*` requests a minute. `api/rate-gate` makes requests
wait rather than exceed that. Poll those paths with `HERMES_POLL_MS` or slower, or pages will feel slow.

Safe reads repeat once after step-up, in the transport. Mutations are never repeated: the error has
`retryAfterStepUp`, and its message asks the operator to submit again. Do not add retries.

## Contracts

`contracts/magnus` is a verified copy of an export from Magnus, checked by `npm run check:contracts`. To take a
newer one:

```bash
# In Magnus
npm run contracts:browser -- --output ./output/magnus-browser-contracts
# In HiveXUI
npm run contracts:magnus:import -- <path to that directory>
```

Then run the checks. Importing the contract brings all of it, so import it only from inside this module: never from
`nav.ts`, `paths.ts` or `routes/`, which the main chunk loads.
