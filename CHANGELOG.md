# Changelog

- Add the Magnus module at `/fleet`: Mission Control, overview and nodes on the shared
  theme, with sidebar navigation, deep links and browser history. One API per installation:
  the control node switcher, federation and embedded Hermes dashboard are gone, and sign-in
  is Oathweave. Pin the Magnus browser contract under `contracts/magnus`, read event
  streams with `fetch` so they carry a fresh token and stop on logout, and hide actions the
  session role cannot use. `links.magnus` is accepted and ignored for one release, and the
  external Magnus link is removed.

- Show a permanent warning strip while Oathweave reports relaxed sign-in limits.
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
