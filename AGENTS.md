# AGENTS.md - HiveXUI

HiveXUI is the UI of the Hive:Magnus suite: a static React (Vite) application with one Oathweave
sign-in and one navigation across every installed product, including the fullscreen Ardent Project
Studio at `/studio`. It has no backend: every call goes to the owning product's API with the
signed-in user's own token, and each product enforces its own authorization. It ships as the
container image `ghcr.io/cheftaco/hivexui` (nginx serving `dist/`). This public Apache-2.0
product was extracted from Hive: preserve LICENSE, NOTICE, `notices/` and provenance.json.

## Privacy

Never commit secrets, private infrastructure, runtime state, local notes or real user data, in
code, tests, fixtures, docs or commit messages. Use `example.com` hosts and placeholder accounts.
Read `AGENTS.local.md` when present; never copy it into tracked content. Activate the hooks with
`git config core.hooksPath .githooks` and never bypass them; they run
`scripts/check-private-data.sh`, `scripts/scan-secrets.sh` and Gitleaks (see CONTRIBUTING.md).

## Layout

| Path | What it holds |
| --- | --- |
| `src/app.tsx`, `src/main.tsx` | Shell, sign-in bootstrap and routing |
| `src/lib/` | Runtime config (`runtime.ts`), transport and auth, the route table (`routes.ts`), navigation, the Registry client, per-product API clients |
| `src/modules/<area>/` | One module per product or suite feature: `magnus` (fleet pages, see its PORTING.md), `studio`, `chat`, `skills`, `security`, `embermend`, `inbox`, `setup`, `agents` (Agent 360), `account`, `workspaces`, `memory-operations`, `suite` |
| `src/pages/`, `src/components/` | Shared pages (Oathweave, Emberpath, HiveMem, incidents, docs) and components |
| `contracts/` | Vendored, browser-safe product contracts, each with provenance (`npm run check:contracts`) |
| `e2e/` | Playwright: `a11y/` (mocked, CI) and `studio/` with the real-stack harness in `stack/` |
| `scripts/` | Contract checks and importers, license collection, privacy and secret scans |
| `docs/` | `STUDIO.md` (Studio routes and workflows), `THEME.md` (tokens and components) |

## Build and checks

Node.js 24.22.3 (CI and the image). `npm ci`, then before a PR run what CI runs:

```bash
npm run build            # typecheck and production build
npm test                 # vitest
npm run check:contracts
npm run scan:secrets
npm run check:private
npm run e2e:a11y         # needs a Playwright Chromium: npx playwright install chromium
```

`npm run e2e` runs the Studio scenarios against a real stack built from sibling checkouts (Docker
needed; skipped without it). `npm run e2e:stack -- up|down` manages that stack. The README's
"End-to-end tests" section lists its variables.

## Contracts

Contracts are vendored, never imported from a sibling checkout. Refresh Magnus with
`npm run contracts:magnus:import` and `npm run magnus:provenance`, ArdentStudio with
`npm run contracts:ardentstudio:import`; the other contracts are copied from the owning product's
reviewed export with their provenance updated. When the Magnus contract moves, update the README's
statement of the vendored Magnus version (Magnus 3.2.0 now).
`@hivemagnus/hive-common` supplies `/errors` and `/contracts` in the browser.

## Conventions

- Strict TypeScript; validate every API response with the vendored Zod schemas before use.
  Browser code never imports backend code or holds infrastructure credentials. Tokens stay in
  memory, never in URLs or browser storage.
- HiveXUI is "the UI" in docs and copy. A section appears only for a product that `runtime.json`
  configures and the Hive Registry lists. Existing route and variable names stay.
- Security behaviour needs a regression test. Conventional Commits.
- Release by pushing a `vX.Y.Z` tag: `.github/workflows/release-image.yml` builds the amd64 and
  arm64 image and records its digest in the GitHub release. There is no npm package.

## Gotchas

- `public/runtime.json` is an empty placeholder, so a plain `npm run dev` stops before sign-in.
  Point a local, uncommitted `runtime.json` at a real suite (see README "runtime.json").
- `npm test` runs `scripts/ci-apt-setup.test.sh` before vitest.
- Playwright specs live under `e2e/`; vitest excludes that directory.
