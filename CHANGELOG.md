# Changelog

## [Unreleased]

- A tab left open across an upgrade says "HiveXUI X.Y.Z is available" with **Reload** (and **Later**) before anything fails. Each build writes `/version.json` (its version and the hashed entry script its `index.html` loads, derived from the bundle so builds stay reproducible); a visible tab reads it every five minutes and when it becomes visible again (at most once a minute), uncached and without credentials. The image's nginx serves `/version.json` with `Cache-Control: no-store`. A development server has no built entry and never asks.

- Session expiry is handled in one place. When Oathweave no longer knows the browser session (`/browser/session` or a new product authorization answers 401), every page and the fullscreen Studio return to sign-in at the same address, with "Your session ended", and the same page opens after signing in again. A 401 from any product asks Oathweave once whether the session still exists (one check for a burst of answers) and signs out only if Oathweave refuses it; an outage or a 5xx keeps the person signed in. The shared store and the Magnus and Studio clients use the same check, so an identity outage no longer signs them out.
- Sign-out in one tab signs out the console's other tabs (a `BroadcastChannel` that carries only the fact, never a token or user detail). They forget their tokens and show the sign-in form, saying that the person signed out in another tab.
- Emberpath 2.7.0 multi-factor accounts on the native console API: the native sign-in and the upgrade's password confirmation read Emberpath's `401 MFA_REQUIRED`, ask for the authenticator or recovery code, and send the same request again with `mfaCode`. Against an older Emberpath nothing changes.
- Pages no longer wait on Emberpath. The shared Emberpath store (providers, routing, keys, traces, audit, incidents and the other System pages) loads only when one of the pages that show it is opened, and only those pages show its spinner and its "N console sections failed to refresh" warning. Chat, Magnus, Cindertrace, IAM and every other page render at once. Upgrade note: the sidebar counts for Emberpath pages appear once one of those pages has loaded.
- The shared store refreshes every minute while one of its pages is on screen, pauses while the tab is hidden, and refreshes on return to a tab hidden for longer. "Synced … ago" and the panel ages keep counting instead of showing the age at the last render.
- Requests have a deadline. A request without its own signal fails after 30 s (reads) or 120 s (writes) without an answer, with "The product did not answer within 30 seconds" and its request ID, instead of a spinner forever. Streams, downloads, uploads and the Magnus and Studio clients, which set their own deadlines, are unchanged, and a body that has started to arrive is never cut off.
- Fix: the incident aggregator's notes (one source's failure summary unavailable) no longer count as failed console sections; Incidents still lists them.
- Chat: the live connection reconnects with exponential backoff and jitter (about 1 s doubling to a minute, reset after a healthy connection) instead of every 3 s forever, and renews the chat session before each attempt. A chat session that cannot be renewed stops reconnecting and says to sign in again.
- The chat reconnect and the Magnus and Studio event streams use `@hivemagnus/hive-common/retry`'s backoff instead of their own copies.

## [0.12.1] - 2026-11-26

- Fix: one failing page no longer blanks the console. Every shell page and the fullscreen Studio sit behind an error boundary that keeps the shell working and offers **Try again** and **Reload console**. A tab left open across an upgrade, whose old hashed chunks are gone, reloads once to fetch the new build (`vite:preloadError` and failed lazy imports); if the fresh page fails the same way it shows "A new HiveXUI version is available" with a reload button instead of reloading again. The search palette and inbox bell fail quietly.
- Fix: an identity service outage at startup shows "The identity service is unreachable" with **Retry** (and the Cindertrace recovery sign-in where it is offered) instead of a sign-in form that could only fail. A signed-out session still shows the form.
- Fix: sign-out also ends the ChatterMost cookie session (`POST /api/v4/users/logout`, best effort, bounded to 3 s) before the Oathweave sign-out.
- Fix: Embermend asks for confirmation, repeating the objective, revision, target count and service impact, before **Approve**, **Reject**, **Start authorized work** and **Pause/Resume dispatch**.
- Fix: IAM and Embermend load their sections independently. One refusal or outage, such as on audit statistics or findings, names the section that failed and leaves the others on screen. A 401 while loading IAM returns to sign-in.
- Fix: a declined product consent prompt can be reviewed again without a full reload: opening a page from the sidebar or search, the Embermend, Skills and Studio refresh or retry controls, and a new **Retry** on Cindertrace pages that failed to load.
- Fix: the sign-in form no longer prefills `admin`, and an empty username or password cannot be submitted.
- End-to-end: the ARDENT-06 acceptance through Magnus (`e2e/studio/ardent-client.api.spec.ts`). `@hivemagnus/ardent-client` 3.2.1 (a devDependency) with `viaMagnus` against the stack's Magnus and an Ardent 3.2.0 agent: submit, follow while a test proxy drops the task stream twice (every journaled event once and in order), lineage with the caller's execution context, recovery reads, a 3 MiB artifact download reset a third of the way in that resumes with `Range` and `If-Range` and matches its SHA-256, and the documented error for a route outside Magnus's allowlist. Two defects it found are pinned to their current refusals: `viaMagnus` cannot use the console's `/api/magnus` base, and a follow that starts without a cursor is refused through the console ingress (an empty `Last-Event-ID`). `stackFetch` in `e2e/studio/support/stack.ts` is a `fetch` that trusts the stack's authority only.

## [0.12.0] - 2026-11-24

- Studio room: state chips for interrupted tasks. **Recovering** (Ardent continues the run under the same task), **Needs decision (effect unknown)** (held; counted among the blockers) and **Unknown outcome** (cannot be resumed), with paused, cancelled and failed unchanged.
- Studio room: a recovery panel on held tasks that shows the reason and only the decisions the backend lists, each confirmed with what it does to the interrupted call, sent once with an idempotency key (`POST /tasks/{id}/recovery`). It is hidden for a Studio without recovery and explains when the agent cannot take decisions.
- Studio room: the lineage drawer (`?lineage=`), from the originating request through hand-offs, reassignments and workflow steps to each Ardent attempt's model attempts (linked to their Emberpath traces), tool calls and artifacts. Old tasks show "No execution history recorded". It reads again on `task.recovery` and task events and after a stream reset.
- Studio room: a **Workflows** drawer for branch-and-join workflow runs: steps, needs, waiting and blocked reasons, and the node actions Studio offers (retry, skip, cancel run), live from `workflow.*` events.
- Deliverable Review: preview renditions shown inline with "Preview · original … PNG"; **Download original** streams with progress, resumes with `Range` up to five times after a dropped connection and saves only after the SHA-256 matches; the Receiving strip shows import progress, resumes and why an import failed; a Provenance panel (manifest 1.1) links to the execution history.
- Agent 360: an **Executions** tab with the profile's recent Ardent tasks through Magnus (state, recovery, root and parent), linked to the Magnus task view. Traffic gains an execution column and a **Linked to executions** view (Emberpath 2.6.0).
- Fix: the Agent 360 Traffic outcome badge reads Emberpath's `SUCCEEDED`, `FAILED`, `DENIED` and `STREAM_FAILED` (every trace showed as failed before).
- Fix: the Magnus Ardent profile page lists artifacts the agent registered (`artifact_registered`), not only research briefs, and downloads through artifact transfer v2 (`/content`, Magnus 3.3.0) with the real type and file name when the profile offers it, checking the digest before saving.
- Magnus Ardent overview: the agent dependency report (`GET /ardent/dependencies`): HiveMem, HiveSkills and Emberpath as usable, missing, unsupported or awaiting configuration, with where each was found, and **Check again**.
- The project stream reads Studio 0.5.0's `task.recovery` and `artifact.import.progress` events (in its contract).
- Contracts: the Magnus browser contract at `4894bfb` (the contracts of Magnus 3.3.0: agent dependency report, studio level 4), the Ardent Project Studio browser contract of Studio 0.5.0 (`633b572`: workflow runs, task recovery and lineage, renditions, resumable imports, template definitions) and the Emberpath model administration contract of Emberpath 2.6.0 (`7cd32f8`: trace execution fields and attempts), with Emberpath 2.6.0's NOTICE in `notices/`. The Studio and Emberpath files have the same bytes as the `4e232cb` and `689b513` exports used during development. The fields Studio 0.5.0 added to tasks, revisions and imports are read as optional, so the room and Review keep working against an older Studio. Ardent's task list, recovery and lineage, which no browser contract describes, are read leniently. `@hivemagnus/hive-common` ^0.6.0 (`/artifact` `selectRendition`, `/execution`).
- End-to-end: scenario stubs for build-plan verification 1-4 and 10 (`e2e/studio/lineage-recovery.api.spec.ts`), skipped on a stack whose agents run Ardent before 3.2.0.

## [0.11.0] - 2026-11-20

- Installed software (`/?page=software`, linked from the Installation overview for administrators): the signed release's version and manifest digest beside each host's activation receipt, and every component's pinned version and image digest beside the image digest, state and health its host last reported (recorded by `hive.sh` in the Hive Registry). A digest that differs from the pin is flagged whatever the version label says. For Magnus, the page reads Magnus's installation report: its running version against the pin, whether it is a native npm install, and every dependency npm resolved differently from the lock the signed build used, such as `effect` 3.20.0 where the signed lock has 3.22.1. Host agents are counted against the pinned version.
- The Hive Registry is a signed-in product (`hive-registry`, prefix `/api/registry`, Oathweave client `hivexui-registry`) for the inventory read only; its public reads stay anonymous. The UI enables it when the Registry's public product entry announces `inventory.v1` (Hive Registry 1.4.0), so `runtime.json` does not change. Without it the page says to upgrade and run `./hive.sh console-clients add`. Against a Magnus without the report (404) the Magnus panel says so and the rest of the page still shows.
- Contracts: Hive Registry browser contract 4 (`inventory.v1` capability, Registry 1.4.0) and its new inventory contract; the Magnus browser contract of Magnus 3.2.0, which adds the installation report (`GET /system/installation`).

## [0.10.3] - 2026-11-20

- Chat: vendor ChatterMost 0.7.1's browser conversation contract. Requests the product now refuses, such as reaction names with path, query or markup characters and over-long profile, channel and post fields, are stopped in the browser with the contract error. Reaction removal builds its path in one tested helper that encodes every segment.

## [0.10.2] - 2026-11-18

- Fleet: Submit test sends a UUID as the Ardent task ID. The task can run and use the profile's HiveMem tools.
- Security: require nginx 1.30.7 or later in the console image and remove unused dynamic modules tied to the older base package.

## [0.10.1] - 2026-11-18

- Security: require `@hivemagnus/hive-common` 0.5.1. Its error reader cleaned a product's error code with a regex that was quadratic on a code of many underscores between two other characters (`a___…a`), so one hostile or broken error answer could stall the tab for seconds. The code is now cleaned in linear time; a regression test reads such a code of 100,000 underscores. A malformed request ID in an error body is now dropped in favour of the response header or the ID HiveXUI sent (hive-common 0.5.0).

## [0.10.0] - 2026-11-17

- Cindertrace sign-in without Oathweave. A `mode: "local"` runtime (Cindertrace only, no identity) signs in with Cindertrace's own API sign-in and shows only Cindertrace's pages, including the investigation lab. On a suite installation with Cindertrace, the sign-in page offers a Cindertrace recovery sign-in for when Oathweave is unavailable; the choice lasts for the tab. Requests to products the runtime does not configure are refused in the browser.
- Cindertrace: label the four suite audit exports Cindertrace collects (HiveMem, HiveSkills, Ardent Studio, Embermend) and attribute them to their products on the Sources page.
- Cindertrace: one vendored browser contract. The lab pages read `contracts/cindertrace` instead of an older copy under `src/modules/security/contracts`, and the contract is refreshed to Cindertrace's current export, which adds the HiveAuditRecord schema.

## [0.9.2] - 2026-11-15

- Magnus: keep the software card's description readable in narrow columns by placing **Check versions** below the heading.
- Magnus: **Check versions** and **Read update cache** use the node's bounded read-only software diagnostic (Magnus 3.1.0, `GET /api/v1/nodes/:nodeId/software`) instead of dispatching shell commands. Pending updates show their cached source and repository refresh time. Reading either status is available to node viewers.
- Magnus: against a Magnus server without the route (404) or a node agent older than 3.1.0 (Magnus answers `409 SOFTWARE_STATUS_UNAVAILABLE`), the card says the software status is unavailable and to update Magnus and the node agent, and sends nothing else. A node that cannot be read for the moment (`503`) shows Magnus's own message instead. A mixed fleet therefore shows older agents as unavailable rather than failing.
- Update the vendored Magnus browser contract to Magnus 3.1.0 (`49f720d`), including the typed software metadata response and read-only route. The file has the same bytes as the `390fdb2` export used during development.
- End-to-end: a node software spec reads the software status through the console ingress, checks it against the contract, presses **Check versions** on node detail, and confirms that neither read dispatched a command.
- Magnus: refresh the Ardent profile list when New Agent finishes successfully. The completed wizard stays open with its **Open profile** button, and the new profile appears below it without navigating away or showing a stale empty-list warning.
- Studio: let the visible brand text label the home link, so speech control can identify the link by what it says on screen.
- Recommendations: give the labeled recommendation list and remediation progress valid semantic roles for assistive technology.

## [0.9.1] - 2026-11-15

- Magnus: Upgrade agents offers **Allow major upgrade** (`allowMajor`, Magnus 3.0.1) to ADMIN against a Magnus that reports 3.0.1 or later. Turning it on asks first, and the confirmation explains the stepping stone (2.10.x → 2.10.3 → 3.x, with `magnus-server agents upgrade --to 2.10.3` for the first step) and the major-upgrade authorization the server signs with its server key for each node, version change and tarball, valid for one hour, which the agent verifies against a server key it pins (so the node needs a bound node key). The drawer then reads eligibility with `allowMajor=true`, sends `allowMajor` with Check and with the run, says in the run confirmation how many selected agents cross a major, and marks a rollout that allowed it ("major upgrades allowed"). The option resets each time the drawer opens; turning it off needs no confirmation.
- Magnus: the agents an allowMajor read holds back are listed by code with Magnus's cause and remedy: `MAJOR_NEEDS_STEPPING_STONE` (older than 2.10.3) and `MAJOR_NEEDS_NODE_KEY` (no active node key). `SELF_UPGRADE_MAJOR_UNAUTHORIZED` and `SERVER_KEY_UNAVAILABLE` show their cause and remedy wherever upgrade codes are shown, and a retry picks up a node refused with them; `MAJOR_VERSION` and `SELF_UPGRADE_REFUSED` carry Magnus 3.0.1's new remedies. Against a Magnus before 3.0.1 the drawer keeps its manual major-version notice and offers no option; a non-ADMIN reads that an ADMIN can include those agents.
- Magnus: the upgrade problem codes now come from the vendored browser contract, which carries Magnus's table, instead of a separate copy, so they follow each contract import.
- Update the vendored Magnus browser contract to Magnus 3.0.2 (`c9eb1ac`): `allowMajor` on the upgrade run, the eligibility query and the start request, the four new upgrade codes, and the new remedies for `MAJOR_VERSION` and `SELF_UPGRADE_REFUSED`.
- End-to-end stack: needs Magnus 3.0.0 or later and writes no shared node key (`NODE_MANAGER_SECRET`, `RESULT_SIGNING_SECRET`, `COMMAND_RECONCILIATION_SECRET`) for the server or the agent. The bootstrap registers the node and the stack binds its key with the one-time enrollment token (`magnus-agent enroll --token-file -`, the token on standard input only). Magnus starts with `NODE_AUTH_MODE` unset, so its start-up guard runs on every start, and the bootstrap checks that the node-credentials summary reports the default enforce mode with no blocker.
- End-to-end stack: the node container gives the `ardent` account `~/.local/share`. Since Magnus 2.10.0 the agent stages an Ardent package beside `~/.local/share/ardent` without creating parent directories, so the package install failed on a fresh node.

## [0.9.0] - 2026-11-14

- Magnus: read Magnus 3.0.0's fleet summary (per-node credentials, phase 3: enforce by default). The Node credentials panel says whether the mode is set in the server's environment or the default (`modeExplicit`), and the mode badge reads "(set)" or "(default)". An explicit `compat` or `warn` that Magnus marks deprecated (`modeDeprecated`) shows a warning at the top of the panel with Magnus's own `deprecationNotice`. The readiness line says that enforce is reached by removing `NODE_AUTH_MODE` (enforce is the default), and to keep it set while a blocker remains.
- Magnus: show the server key rotation from the summary (`serverKeyRotation`): the active and staged key fingerprints, how many keyed agents pin each, the replaced key with the end of its grace period, the retired keys, and the next step (wait for the pins, promote, retire). Rotating the server key is not a browser route, so the panel shows the API and `magnus-server node-auth server-key` steps as text, with no buttons.
- Magnus: name the new enforce blocker `AGENTS_NEED_UPGRADE` in plain words: upgrade these agents (2.10.0 or 2.10.1) to 2.10.2 or later.
- Magnus: in enforce mode, Reset on node detail stays disabled and says why: Magnus 3.0.0 refuses it (also in its default enforce mode), Revoke still works, and moving a node back to the shared secret needs an explicit `NODE_AUTH_MODE=compat` on the server first.
- Magnus: against a Magnus before 3.0.0, which sends none of these fields, the panel and node detail read as before.
- Magnus: node detail holds Reset back until it knows the server's node-auth mode. While the fleet summary is being read, Reset is disabled with "Checking node-auth mode…"; if the summary cannot be read, Reset stays disabled, says that Magnus refuses it in enforce mode, and the reset step is shown as CLI and API text. Revoke is unchanged.
- Update the vendored Magnus browser contract to Magnus 3.0.0 (`2474701`): the 3.0.0 summary fields, the server key rotation read model and the `AGENTS_NEED_UPGRADE` blocker. The contract has the same bytes as the Magnus main `dbef84d` export used during development.

## [0.8.0] - 2026-11-14

- Magnus: administrators can list, revoke and reset a node's keys on node detail (Magnus `c158e8c` and later, which publishes these as browser routes). The Node credential card lists every key with its fingerprint, status, origin, creation and last use. Revoke and Reset open the shared confirmation, which says in plain words what follows before anything is sent (revoke: the agent is refused until the node is enrolled again or reset; reset: the node is accepted with the shared secret again and binds a new key by itself while the automatic upgrade window is open), and takes an optional reason (up to 500 characters, counted) for Magnus's audit log. Each confirmation sends one request with its own idempotency key. Magnus's answer stays on the card, and the node, its keys and the summary are read again. Reset is not offered in enforce mode, and Magnus's refusal codes (`NODE_CREDENTIAL_NOT_FOUND`, `NODE_AUTH_ENFORCED`, `DUPLICATE_REQUEST`, `VALIDATION_ERROR`, `FORBIDDEN`) are shown as operator messages. Rotating a key and issuing an enrollment token stay CLI and API steps. Operators and viewers see no key buttons, and the key list is not requested for them.
- Magnus: rejecting a pending key binding takes the same optional reason, sent to Magnus with the rejection.
- Magnus: against a Magnus that answers the key list with 404 (an older release, or an ingress without the routes), node detail shows the CLI and API steps as before, without an error.
- The shared confirmation dialog can hold a field, such as a reason, inside its focus loop; focus still starts on Cancel.
- Update the vendored Magnus browser contract to Magnus `c158e8c` (node key list, revoke and reset as ADMIN browser routes, with their reasons and consequence fields).
- Magnus: show per-node credentials (Magnus 2.10). The Nodes list has a Node key column (own key, shared secret, key revoked, or awaiting approval), and node detail has a Node credential card with the key fingerprint (administrators only), how the key was bound, when it was bound and last used, whether the agent signs its evidence, and how often the shared credentials were still used for the node, per channel.
- Magnus: a Node credentials panel on the Nodes page (administrators and operators) shows the fleet's progress towards `NODE_AUTH_MODE=enforce`: the mode, the server key fingerprint, the automatic upgrade window, counts, recent use of the shared credentials, and each blocker with what to do about it. The Magnus fleet overview raises waiting bindings, revoked keys and an unreadable server key, as it does Tailscale renewals.
- Magnus: administrators can approve or reject a key binding Magnus refused for its address, behind the shared confirmation that shows the key fingerprint, the host name the agent claims, the address it called from and the recorded address. The summary and the list are read again afterwards.
- Magnus: node detail has a "Check a downgrade" tool (administrators and operators) that asks Magnus whether an older agent version keeps the node key, and shows the steps for `reset-credentials` and `enroll-instead`. Rotating, revoking, resetting and re-enrolling a key are not browser routes in Magnus yet, so node detail shows their CLI and API steps as text.
- Magnus: all of this stays hidden against a Magnus without per-node credentials (no `nodeCredential` on a node, or a 404 from the summary route), without an error.
- Update the vendored Magnus browser contract to Magnus `782d14a` (per-node credential read models, the node credential routes and the HiveEvent feed schema).
- Providers: keep stored credentials with the server they were entered for. When the base URL of a provider is changed to another server (a different scheme, host or port), the form says so in plain words and asks for the auth secret and any hidden default header values again before it saves; a path change on the same server asks for nothing. Emberpath enforces the same rule from its next release, and its refusal codes (`provider_origin_change_requires_secret` and related) are shown as operator messages. The check also runs against older Emberpath releases, which did not enforce it.
- Providers: handle default headers Emberpath no longer shows. Values that may be credentials arrive as `[redacted]`; leaving one in place keeps the stored value, and the form refuses to send `[redacted]` for a header that has no stored value, so a stand-in is never saved as if it were real. The Auth Secret hint says whether a secret is stored.
- Settings: after a configuration import, name the default headers whose values the file did not contain and that have to be entered again.
- Read the stable `code` Emberpath sends beside a text error message; it was reported as the status default.
- Update the vendored Emberpath model administration contract (hidden-credential read fields, write refusal codes, import result, base URLs without user info, the `v1.decisions` route kind, trace paging). Providers that list `v1.decisions` among their routes, as `OPENAI` providers do since Emberpath 2.4.0, can be read again.
- Report a success answer HiveXUI cannot read as one operator message ("Emberpath answered in a format this version of HiveXUI cannot read.") with its request ID, instead of the schema library's issue list or a JSON parser error. This covers the Emberpath, Oathweave, HiveSkills, HiveMem dashboard, Embermend and incident-summary clients, which now raise the shared `HiveContractError`; after a change it says the change was sent and to refresh.
- Report a gateway error page at sign-in by its status ("Oathweave could not be reached (HTTP 502). Try again in a moment.") instead of "Unexpected token '<'".
- Link the Codex device authorization page on Providers, and release notes on the legacy update panel, only when the address the product sent is http or https; anything else is not rendered as a link.
- Stop the inbox from showing "Couldn't reach" for every product for up to a minute after returning from a fullscreen product (Studio) that was opened while feeds were still being read; it now asks again at once.
- Announce a failed sign-in to screen readers (`role="alert"`).
- Keep a copy button quiet when the browser has no clipboard or refuses the write, instead of raising an unhandled error.
- Show "Sign in again to continue this conversation" in chat only when the session check is refused, not when one check fails to get through.
- Pin the vendored contracts to released product tags: the Magnus browser contract to Magnus 2.10.0 (`32417a3`) and the Emberpath model administration contract to Emberpath 2.5.0 (`b9c7568`), both with the same bytes as before; the Oathweave browser contract and OpenAPI reference to Oathweave 2.3.0 (`d2ac3c0`), whose browser schemas are unchanged and whose OpenAPI document adds the browser OpenID discovery route and schema, the `authLimitsRelaxed` flag and a description of the code exchange rules.

## [0.7.0] - 2026-11-12

- Search records from the command palette (Ctrl+K) beside screens: Magnus nodes and Hermes agent profiles, Ardent Project Studio projects, HiveMem memories, Cindertrace cases, Emberpath traces by exact trace or request ID, HiveSkills skills, and Oathweave users and clients. Each source is asked only when its product is installed and configured and the person's role can read it, using the released browser contracts HiveXUI already vendors; a refusal (401 or 403) hides it silently. Lists without a server-side search (Cindertrace cases, Hermes profiles, the HiveSkills catalog, Oathweave clients, recent Emberpath traces) are read and filtered in the browser, so the query is not sent to them.
- Wait 200 ms after typing and need at least two characters. Each source has 1.5 seconds; results join as each answers, grouped by product, with "searching…" beside a product still answering and a quiet "Couldn't search" line for one that failed. Each source shows at most five records, with "See all" where the product's page takes the query (Studio projects, HiveMem memories). Every result opens an address from the route table; agents open Agent 360. Arrow keys move across groups, and the result count is announced to screen readers.
- Add the Studio project page (`/studio/p/<projectId>`) to the route table, so `linkTo('ardentstudio', 'project', { projectId })` addresses it.
- Let a background read skip the verification prompt: `quietApiFetch` returns a refusal that needs step-up as the 403 it is. Palette search uses it.
- Add the Setup page (`/?page=setup`): the first-run checklist the Hive Registry records on the installation (`setup` on `GET /v1/installation`) after an install or upgrade. Each item shows its title, status (pending, done or skipped), its `./hive.sh` command with a Copy button, and its docs anchor as text, since the runtime configures no public docs address. Items with an ID or check HiveXUI does not know show the same way, without a check. HiveXUI never writes the checklist.
- Check three items HiveXUI can read for itself, through `quietApiFetch` so no verification prompt opens: `magnus.agent` (an online Magnus node reports a running agent; the Registry gives no host to match, so any node counts and the page says so), `oathweave.console-client` (every Oathweave client in runtime.json exists and is active) and `iam.first-admin` (an active `SUPER_ADMIN`, `SUITE_ADMIN` or `admin` account other than Oathweave's oldest, the initial operator). A pending item a check finds in place shows "Looks done" with the command that records it: `./hive.sh post-upgrade`, or the item's own `./hive.sh setup done` command. A refusal or failure says it could not check.
- Show administrators a Setup nudge in the header with the number of pending steps; it is hidden when nothing is pending or the Registry records no checklist. The page and the nudge are for administrators only (a `*` grant, or the `admin`, `SUPER_ADMIN` or `SUITE_ADMIN` role).
- Vendor the Hive Registry browser contract version 3 from Hive (`services/hive-registry/src/browser-contract.ts` at bceea1a), which adds the setup checklist. A checklist, or one of its items, that HiveXUI cannot read is dropped without failing the installation read.

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
