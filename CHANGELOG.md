# Changelog

## [Unreleased]

- Search records from the command palette (Ctrl+K) beside screens: Magnus nodes and Hermes agent profiles, Ardent Project Studio projects, HiveMem memories, Cindertrace cases, Emberpath traces by exact trace or request ID, HiveSkills skills, and Oathweave users and clients. Each source is asked only when its product is installed and configured and the person's role can read it, using the released browser contracts HiveXUI already vendors; a refusal (401 or 403) hides it silently. Lists without a server-side search (Cindertrace cases, Hermes profiles, the HiveSkills catalog, Oathweave clients, recent Emberpath traces) are read and filtered in the browser, so the query is not sent to them.
- Wait 200 ms after typing and need at least two characters. Each source has 1.5 seconds; results join as each answers, grouped by product, with "searching…" beside a product still answering and a quiet "Couldn't search" line for one that failed. Each source shows at most five records, with "See all" where the product's page takes the query (Studio projects, HiveMem memories). Every result opens an address from the route table; agents open Agent 360. Arrow keys move across groups, and the result count is announced to screen readers.
- Add the Studio project page (`/studio/p/<projectId>`) to the route table, so `linkTo('ardentstudio', 'project', { projectId })` addresses it.
- Let a background read skip the verification prompt: `quietApiFetch` returns a refusal that needs step-up as the 403 it is. Palette search uses it.

## [0.6.0] - 2026-11-12

- Add the suite inbox: one list of notable events from every installed product that announces a HiveEvent v1 feed (`events.v1`) in the Hive Registry, read through each product's browser prefix with the shared transport. Events are validated with `@hivemagnus/hive-common/contracts`, deduplicated by ID and shown newest first; an invalid event is dropped without losing the rest of its page. It replaces the Magnus-only notification bell: the header bell shows the unread count and the newest events in a drawer, and the Inbox page (`/?page=inbox`) filters by product, severity and read state.
- Keep a last-seen position per person and product in local storage; "Mark all read" advances it. Magnus events also follow Magnus's own read flags, matched by the notification ID in `sourceRef`, and "Mark all read" marks them read in Magnus. With storage blocked, marks last until the page reloads.
- Poll every 60 seconds while the tab is visible. Each product has 5 seconds; one that fails or times out shows a "Couldn't reach" row and never holds up the others.
- Link an event only to a page the route table knows and this installation shows; any other path is shown as text.
- Open the Embermend recommendation named by `?plan=<id>` or `?campaign=<id>`, the addresses Embermend's events link to.
- Read the optional `capabilities` object on Hive Registry products and connections from the vendored Registry browser contract. A product whose `events.v1` path is unusable keeps its place in the catalog and serves no feed.
- Vendor the Hive Registry browser contract version 2 from Hive's own export (`services/hive-registry/src/browser-contract.ts`), replacing the hand-written local pin. It adds product capabilities; the check now verifies its source path, revision and checksum like the Magnus and Cindertrace contracts.
- Require `@hivemagnus/hive-common` 0.4.0.

## [0.5.0] - 2026-11-12

- Add Agent 360 at `/agents/<magnusNodeId>~<profile>`: one page for one agent, with a tab per product. Overview shows the agent's identity from Magnus (`GET /api/v1/agents/:agentRef/identity`) with its node and profile; Memories, Projects, Cases, Traffic and Skills list what HiveMem, Ardent Project Studio, Cindertrace, Emberpath and HiveSkills hold for it. Each tab says when its product is not installed, when the agent has no HiveMem actor to match by, when the product release cannot filter by agent, and when the product refuses this account; a release that ignores the filter is detected and its unfiltered answer is never shown as this agent's. Every tab is filled with Magnus 2.7.0, HiveMem 1.5.0, Ardent Project Studio 0.3.0, Cindertrace 0.4.0, Emberpath 2.2.0 and HiveSkills 1.5.0 or later.
- Link to Agent 360 from the Magnus Ardent profile and Hermes profiles pages, from Agent Studio and the room's agent card, and from Cindertrace case entities of type `agent` that carry an `agent-ref` alias. `linkTo('agents', 'agent', { agentRef })` builds the address.
- Let the Memories page keep one agent's memories with `?agent=<actorId>` and an Agent field, using HiveMem's `agent_id` filter.
- Refresh the vendored contracts: the Magnus 2.7.0 browser contract with agent identity, HiveMem 1.5.0 (`agent_id` in memory search), and Ardent Project Studio 0.3.0 (`agentRef` on the project list).

## [0.4.0] - 2026-11-12

- Read every product's error answers, including the suite error envelope, through `@hivemagnus/hive-common/errors`, so failures show a consistent message and keep the product's code, details and request ID.
- Send an `x-request-id` with every API request and keep the answer's request ID on the error, so a failure can be quoted and traced.
- Accept ingress product names (`/api/oathweave/...`) as API paths beside the older logical aliases, which remain for legacy recovery runtimes without product prefixes.
- Present every product section through the shared UI kit, now including data tables, tabs, pagination, filter bars and menus, with framed tables, page headers and consistent empty and loading states.
- Confirm destructive actions, including IAM, actor, memory and chat deletions, in the shared confirmation dialog instead of the browser prompt.
- Give each audit and incident page a product-qualified name in the sidebar, breadcrumb, command palette and page header.
- Derive the sidebar, command palette, breadcrumb, page titles and deep links from one typed route table. Every existing address opens the same screen.
- Render the Cindertrace pages as client components listed in the sidebar. A refresh after an action keeps the page and its message on screen.
- Serve suite and legacy runtimes from one installation overview, and split the IAM page into one view per section without changing its behaviour.
- Check pages for serious and critical WCAG 2.1 A/AA violations with axe against a mocked runtime, and fix the accessible names and keyboard access it found.
- Give the Magnus fleet timeline and data retention their own pages again (`/fleet/fleet-timeline`, `/fleet/retention`) with sidebar entries, sharing their panels with Fleet readiness. The timeline links an event only to a page the operator's role and the Hermes setting allow, and retention lists the tables nothing purges.
- Bring the agent upgrade drawer up to date with the old dashboard: how many agents are ready, a notice for agents on another major version, an explanation when none can be upgraded, and the previous rollout folded away. Unavailable agents keep readable reasons instead of being dimmed.

## [0.3.0] - 2026-11-12

- Add concise Embermend recommendations, scoped decisions, pause controls, evidence links and durable outcomes through the existing suite identity.

- Accept the product-owned deployment resource binding contract, preserving global deployment identity independently of host-local Magnus resource names.

- Show retained versus settled execution ownership, provide scoped operator observation of original jobs, and require recovery authority before starting recovery plans. Observation reads the original operation and never repeats dispatch.

- Show independent source and runtime remediation outcomes, preserve unknown exposure and mitigation, and require every applicable recorded dimension before claiming verified security.

## [0.2.8] - 2026-11-11

- Build on patched Node.js 24.22.3 for upstream TLS and HTTP/2 security fixes.

## 0.2.7 - 2026-11-11

- Observe dispatched command statuses and selected output until their terminal result, retrying reads without redispatching work and stopping when the view closes.
- Use the registered uptime diagnostic and its 60-second budget in the quick action; explain custom-budget outcome review before dispatch.
- Explain that Ardent profiles must be stopped before a package update and started after verification.

## 0.2.6 - 2026-11-10

- Require Alpine libxslt 1.1.43-r4 or newer, including fixes for CVE-2026-9947 and CVE-2026-87636.
- Execute and scan each native image before publication, including unfixed HIGH/CRITICAL findings, retain raw reports and verify the published runtime matches the scanned candidate.

## 0.2.5 - 2026-11-10

- Command results refresh the displayed status from the same server response, including pending, failed and timed-out commands.
- Fresh Studio readiness explains how to install or start its first Ardent agent while preserving dependency failures and access denials.

## 0.2.4 - 2026-11-09

- Command dispatch offers a finite timeout and binds it to the approval dialog.
- Cron Jobs supports creating, pausing and resuming finite managed UTC schedules on enrolled
  nodes, with explicit expiry, execution budgets and increasing revisions. Expired authority is
  shown clearly, and viewers receive status without write controls.

## 0.2.3 - 2026-11-09

- API-key privacy controls use the reviewed Emberpath 2.0.3 contract, which accepts metadata-only
  traces. Metadata examples use supported fields and explain where custom labels belong.

## 0.2.2 - 2026-11-09

- A signed-in user without an Emberpath identity can use other products without a misleading
  console-wide Unauthorized warning. Router reads remain disabled; session expiry and service
  failures remain visible.

## 0.2.1 - 2026-11-09

- The installation overview probes Ardent Project Studio at the versioned readiness route from
  its public contract, fixing a false failure after a full-stack installation.

## 0.2.0 - 2026-11-08

### Added

- Ardent Project Studio, a fullscreen page at `/studio` for the `ardentstudio` product (runtime
  product, `/api/ardentstudio` transport prefix, readiness row and a Studio sidebar section shown
  only when it is installed). It renders outside the console shell with its own top bar, project
  switcher, Files and links drawer, connection state, per-area help and a Close Studio button that
  returns to the page it was opened from. Every page waits behind a Magnus check for at least one
  Ardent agent; a Magnus ADMIN can open New Agent from that check. The ArdentStudio browser
  contract is vendored with provenance and a check (`contracts:ardentstudio:import`).
- Studio projects: a home with real project summaries, search, Active, Archived and Needs review
  filters, open question and review badges, active tasks and the last activity line, followed live
  from the project event streams. `/studio/new` creates a project from a brief, deliverables, file
  and link references with their HiveMem indexing state and retry, and a starting team from a
  template, another project or blank. "Propose a team from the brief" asks the coordinator or a
  chosen agent and shows the proposal as a diff that is applied only on Accept.
- Team Assignment: a canvas, Workflow and Table view over one draft team, with role cards, four
  relationship styles, auto-layout, a full keyboard model, a role inspector, agent binding and
  New Agent in a drawer, validation, Publish, reassign, and a work-aware role delete with Undo. The
  template Gallery lists team and agent templates with versions, Use, Customize, Duplicate as
  variant and Archive, and offers a newer pinned version as a per-change diff.
- The Conversation Room: an isometric room drawn in SVG beside the transcript, fed by the agent
  activity the ArdentStudio service derives with a live speaking overlay. Replies stream as
  Markdown and are replaced by the stored message. The composer has recipients, mentions, threads
  and attachments; clarification and decision cards, discussions, Tasks and Decisions drawers,
  layout editing, keyboard navigation, a screen reader roster and throttled announcements.
- Agent Studio at `/studio/agents/:agentRef` and per project: identity and presentation, SOUL.md
  and IDENTITY.md with history, skills and provider settings, project knowledge and private
  memory, a per-person draft with a streaming preview and Apply with per-part results (including
  `activation_required` and Magnus refusals), development records with comments, the HiveMem
  credential Magnus renews, and installs of HiveSkills catalog skills. Ardent profile pages link to
  it with Open in Studio.
- Deliverable Review: deliverables with review status, revisions checked against their SHA-256,
  previews for Markdown, text, images, PDF and DOCX, compare views, anchored comments, revision
  requests to the producer role, Accept, Request changes, Reject, Mark final and export packages.
- Magnus: a New Agent wizard for Ardent profiles (node, profile, SOUL.md and IDENTITY.md, model,
  skills, required HiveMem, review and a deploy checklist that follows the operation with resume
  on failure), Enable HiveMem for existing profiles, the HiveMem credential state and renewal times
  on profile pages, a HiveSkills catalog picker on the profile Skills tab, and the Ardent command
  owners holding a node with reconciliation of an action whose outcome is unknown (ADMIN only).
- `docs/STUDIO.md` and end-to-end acceptance scenarios (`npm run e2e`) against a stack built from
  source.

### Fixed

- Skill lists and Agent Studio drafts take a skill's enabled state from the saved configuration and
  say when it applies after a restart; Ardent reads refused with 429 wait out `Retry-After`.
- New Agent accepts nodes whose agent reports a later Studio bridge level.
- The Magnus console no longer sets a timeout for the removed Ardent profile import action.

## 0.1.1 - 2026-11-05

### Security

- Serve from `nginxinc/nginx-unprivileged:1.30.6-alpine` (nginx 1.30.6 stable on Alpine 3.24),
  pinned by digest, in place of `1.29-alpine`. The 1.29 line has no newer image. The image build
  applies current Alpine fixes and removes curl and libcurl, which nothing in it uses. 0.1.0
  scanned at 1 critical and 49 high findings with fixes available, from curl, libcurl, OpenSSL,
  c-ares, brotli and others in the base. A Trivy 0.70.0 scan of this image finds no high or
  critical findings, fixed or unfixed.
- Send the Content-Security-Policy, `X-Content-Type-Options` and `Referrer-Policy` headers on every
  response. The console page, its assets and `runtime.json` went without them, because a location
  that set its own `Cache-Control` dropped the server's headers. Only `/health`, `/api/` and error
  pages had them.

## 0.1.0 - 2026-11-05

First release of the HiveXUI console image.

- Use the Hive Registry as the source of what is installed: a section shows only for a product that
  `runtime.json` configures and the Registry lists. An unreachable, malformed or empty Registry falls
  back to `runtime.json` with a warning on the overview, and the portal and sign-in never wait on it.
- Show the installation ID on the Hive overview, and each installed product's documentation,
  repository, license and native API URLs there and on API Docs. Add a required `Registry` row to the
  readiness checks. The browser contract is pinned locally until Hive exports one.

- Give the whole console the Magnus look, as its one theme: near-black surfaces, neon cyan and
  magenta, saturated status colors that glow, a grid backdrop, and display headings and labels in
  mono. The light theme, its toggle and the operating system preference are gone for now; tokens
  stay semantic so a light theme can return without touching components.
- Bring stat tiles back to the old console's shape with tone-colored figures and gradient or
  trend footers, and give the Hive, Emberpath Routers and Cindertrace overviews a radar and gauges
  from real data.
- Group the sidebar by product, with Magnus next to Hive as one product with sections. Only the
  current product is open until someone opens another, and the choice is remembered. Add the hover
  sheen and the indicator that springs to the active page.
- Replace the top bar's title stack with a terminal breadcrumb and blinking cursor, and show the
  shell's Refresh only on pages that have none of their own.
- Add a `Ctrl` or `Cmd` + `K` palette over every visible screen, a Magnus notification bell with an
  unread count, and a toast slide with a progress line and a dismiss button.
- Say what the Magnus live strip is really doing. It read Connecting until the stream opened, which
  restarted its wait on every navigation, and also after the stream had given up, while it scrolled
  recent activity from the API. It now reads Recent, Connecting, Live, Reconnecting or Not live, and
  moving between pages no longer delays it.

- Add the Magnus module at `/fleet`: Mission Control, overview and nodes on the shared
  theme, with sidebar navigation, deep links and browser history. One API per installation:
  the control node switcher, federation and embedded Hermes dashboard are gone, and sign-in
  is Oathweave. Pin the Magnus browser contract under `contracts/magnus`, read event
  streams with `fetch` so they carry a fresh token and stop on logout, and hide actions the
  session role cannot use. `links.magnus` is accepted and ignored for one release, and the
  external Magnus link is removed.

- Show a permanent warning strip while Oathweave reports relaxed sign-in limits.

- Redeem chat invites at `/signup` without signing in. The page calls ChatterMost's public
  signup route anonymously and creates a native chat account with its own password; the
  invite code leaves the address bar on load. Admins now get a link with the code in its
  fragment. It does not create an Oathweave account or a link: console chat still needs both.

- Show chat conversations oldest first. They were newest first with the composer below them.

- Add to the chat composer an emoji picker with search and recents, a typed `/` command
  palette in conversations with a bot, and Enter to send (Shift+Enter for a new line). Add a
  bot-responding indicator, a webhook marker with message details, a first-weeks welcome
  strip, jump to latest, and reading position that holds while earlier messages load.

- Show the Cindertrace Lab tab and overview link only when `GET /lab` reports it enabled.

- Name every Cindertrace source by product; source IDs are unchanged. Sources shows a feed
  only if it has reported anything, a live collector may send it, or its product is
  installed, and names the rest. An unreported alias no longer masks one with an error.

- Give the console one visual theme. A single token file defines color, type, radii and
  spacing for light and dark, Tailwind maps onto it, and security, chat and all other pages
  share one set of buttons, badges, panels, empty states, tables, fields and page headers.
  Text is at least 12px and color pairs meet WCAG AA. See `docs/THEME.md`.

- Keep the page from scrolling sideways on phones: multi-column layouts collapse below
  640px and wide tables scroll inside their own container.

- Show only installed products. Group navigation by owning product, drop sections and
  overview rows for absent products, send bookmarks to them to the overview, and stop
  background reads of their APIs. Incidents, API Docs and Settings now work without
  Emberpath. Access errors for installed products are unchanged, and legacy recovery
  mode stays unfiltered. Accept `magnus` as a runtime product for a later module.

- Refresh safe GET/HEAD reads once after shared step-up verification with newly acquired resource credentials. Keep mutations and approvals manual, and reject verification completion after logout.

- Add the central Oathweave authorization portal for registered external public clients, reusing sign-in/MFA/consent and enforcing PKCE, bound response/redirect validation, duplicate-request suppression and logout-safe one-use navigation without frontend token exchange.

- Keep the mobile navigation backdrop below its menu so product links remain
  visible and pointer-accessible. Place it in the same stacking context as the
  sidebar and retain the higher backdrop for modal drawers.

- Give mobile navigation an explicit themed surface, a comfortable target and a
  visible keyboard focus indicator in both themes.

- Give investigation and evidence controls explicit theme backgrounds so enabled
  security actions retain readable contrast in dark mode. Adapt warning text to
  each theme and make scrolling event and collector records reachable by keyboard.

- Compute suite incident summaries from independently authorized product APIs,
  project safe event details and surface unavailable sources; retain investigations
  in their owning products and update installation-health guidance for the suite.

- Consume immutable HiveMem-owned CRUD, search, queue/worker and session contracts;
  retain generated URL/array limits and report malformed summary sections. Use
  native offset pagination so browsing subsequent memory pages advances correctly.

- Validate every Models, Routing, Keys, Traces, Audit and Settings API payload
  with the immutable Emberpath browser contract, including selection previews,
  revision recovery, quota history and Codex authorization. Render documented
  endpoint paths from the native route field.

- Validate complete native version-1 configuration archives and legacy bare
  imports with the owned Emberpath contract, retaining known source metadata.
- Keep populated navigation count badges readable in both color themes.

- Validate provider and alias writes with Emberpath's checksum-pinned, versioned
  browser contract and derive request types from its schemas. Retain source
  attribution, handle legacy null capabilities, and name configuration exports
  for Emberpath.

- Convert provider model read records into validated edit requests, preserving
  capabilities and model settings while excluding persistence metadata and native
  nulls. Report invalid capability JSON before editing and retain saved credentials.

- Keep chat member checkboxes at their native control width so group selection labels remain readable in the console rail.

- Append, drop, paste and remove pending chat files with atomic ten-file limits; protect drafts during sending and reuse each completed upload on manual retries. Keep mobile channel navigation readable.

- Review and revoke explicit identity sessions instead of grouping clients by
  shared network/browser metadata. Preserve independent sign-ins behind NAT.

- Present complete health, upgrade and recovery CLI workflows for suite operators,
  including isolated rehearsal and explicit write reconciliation before restore.

- Port chat channel creation/discovery, membership and policy controls, group
  messages, pinned messages, profiles/avatars, attachment previews, reactions,
  slash-command discovery and paginated history. Preserve conversation deep links
  and reject stale responses after navigation between channels or threads.
- Add product-owned chat administration for users, invitations, privacy, emoji,
  supervision, agents and bots. Reconcile uncertain bot operations by their exact
  receipts; tokens remain one-time values cleared on section or visibility changes.

- Add exact HiveSkills publication review, expiring one-use approval and original Magnus job receipt reconciliation with explicit unconfigured states.

## Unreleased ecosystem extraction

- Move technical identity enrollment, explicit resume, native credential rotation, containment and one-time receipt recovery to owned Oathweave APIs. Use product-specific sign-in permissions and validate the released enrollment contract; retained standalone console paths remain available for recovery.

- Match HiveMem native queue administration: general agent wildcards do not grant
  administrator actions without an explicit administrator scope or role.

- Port sessions, workspace webhook administration and delivery history, graph evidence,
  conflict review, consolidation history and queue controls through owned HiveMem APIs.
  Separate product read/write permissions and retain consolidation request IDs after
  uncertain network outcomes. Destructive and dispatch actions require explicit review.

- Add workspace creation, policy/membership editing, archive/restore, resolved policy
  and consolidation scheduling through owned HiveMem contracts. Use resource scopes
  for memory writes and queue administration, and skip unrelated unauthorized reads.
- Refresh active memory searches after creation, editing and deletion, retaining
  the selected workspace and page where possible.
- Clear a deleted memory after HiveMem returns its native empty 204 response.

Add lazy Skills catalogue/administration, immutable archive releases, channels,
assignment enrollment, receipts and audit from the owned Skills API contract.
Memory workflows use native product routes; installation summaries read each
configured product API and retain valid suite sign-in when a product denies access.

Static TypeScript console extraction with branded themes, resource-scoped in-memory authentication, and candidate security/chat modules. Workflow parity and production migration remain pending.

Public runtime configuration rejects embedded credentials and unsafe identity URLs. Suite lifecycle controls present the Hive controller workflow while managed job integration remains pending.

- Add account authentication controls, passkey sign-in, explicit consent, step-up and recovery forms using owned Oathweave browser contracts.

- Consume immutable product-owned Oathweave and HiveSkills browser validators for identity administration, authentication, enrollment and complete registry operations. Preserve request refinements and native response compatibility; reject malformed requests before dispatch and malformed response envelopes before use.
