# HiveXUI

HiveXUI is the single browser console for the Hive:Magnus suite: one sign-in and one navigation
across every installed product. It is a static React application. Every operation goes to the
owning product's API with the signed-in user's own credentials. Products keep their independent
APIs and can still run without it.

It is one product in the [Hive:Magnus](https://github.com/ChefTaco/hive) suite. The
[Hive installer](https://github.com/ChefTaco/hive#readme) deploys tested combinations of the
suite's products.

This project was extracted from Hive with its migration history and client protocols intact.
`provenance.json` records the source revision and original file hashes.

## Modules

The sidebar has one section per installed product, plus Hive and System.

| Section | Runtime key | What it covers |
| --- | --- | --- |
| Hive | | Installation overview, and Incidents across Emberpath, Oathweave and HiveMem |
| Oathweave | `oathweave` | Overview, account security (passkeys, MFA, recovery, consent and step-up), users, roles, service accounts, clients, sessions, system users, security and audit |
| Oathweave: Actors | `oathweave`, `emberpath`, `hivemem` | Agent enrollment. Needs all three products, because each enrollment links all three |
| Emberpath | `emberpath` | Routers, providers, routing, testing, traces, API keys and audit log |
| HiveMem | `hivemem` | Memories, memory operations and workspaces |
| HiveSkills | `hiveskills` | Skills catalogue, immutable releases, assignments, agent targets, distribution receipts, deployment jobs and registry audit |
| Cindertrace | `cindertrace` | Security cases, entities, events, evidence, sources, policies, audit and approval controls. Not the investigation lab, which keeps its own console |
| ChatterMost | `chattermost` | Channels, DMs, threads, files, search, message editing, reactions, realtime refresh and administration. Invite redemption is at `/signup` |
| Magnus | `magnus` | Fleet, operations, provisioning, Hermes Agent, Ardent and Codex pages at `/fleet`, and a web terminal on node detail where a fleet gateway is deployed |
| Studio | `ardentstudio` | Ardent Project Studio: Projects and Gallery open a fullscreen page at `/studio`. Needs at least one Ardent agent in Magnus |
| System | | API docs and settings |

Cindertrace's [investigation lab](https://github.com/ChefTaco/cindertrace/blob/main/docs/INVESTIGATION-LAB.md)
is a separate disposable installation with its own console and local sign-in. Lab startup rejects
Oathweave settings, and HiveXUI reaches Cindertrace with Oathweave sign-in, so a suite console
never shows a lab. The section adds a Lab tab only when the connected Cindertrace reports its lab
enabled, which an Oathweave-connected Cindertrace does not.

`src/modules/magnus/PORTING.md` lists what the Magnus module leaves out on purpose, such as its own
sign-in, federation across control nodes and the embedded Hermes dashboard. The old Magnus pages
`/fleet-timeline`, `/retention` and `/hermes-security` have no equivalent here yet.

Native frontends and clients stay available until each module passes acceptance. Synthetic browser
renders do not establish backend authorization or workflow parity. See the
[releases](https://github.com/ChefTaco/HiveXUI/releases) for what has been published.

## Theme

There is one dark theme for now, and the console does not follow the operating system or keep a
preference. Tokens stay semantic so a light theme can return without touching components.
[docs/THEME.md](docs/THEME.md) describes the tokens and components, and how a page adopts them.

## Build and run

Build with `npm ci --ignore-scripts && npm run build`; run the browser boundary
regressions with `npm test`. `Dockerfile` serves only compiled assets as UID 101.
The web container has no application backend, database client, signing keys or
infrastructure credentials. Configure HTTPS and API routing in a separate ingress.

### runtime.json

Mount a public `/usr/share/nginx/html/runtime.json` in the static container:

```json
{
  "schema": 1,
  "products": {
    "emberpath": "/api/emberpath",
    "oathweave": "/api/oathweave",
    "hivemem": "/api/hivemem",
    "hiveskills": "/api/hiveskills",
    "cindertrace": "/api/cindertrace",
    "chattermost": "/api/chattermost",
    "magnus": "/api/magnus"
  },
  "identity": {
    "issuer": "https://identity.example.com",
    "apiPrefix": "/api/oathweave",
    "clients": {
      "emberpath": "hivexui-emberpath",
      "oathweave": "hivexui-oathweave",
      "hivemem": "hivexui-hivemem",
      "hiveskills": "hivexui-hiveskills",
      "cindertrace": "hivexui-cindertrace",
      "chattermost": "hivexui-chattermost",
      "magnus": "hivexui-magnus"
    }
  }
}
```

Register every selected public client and its exact
`https://console.example.com/auth/callback` redirect URI in Oathweave. Configure
resource permission ceilings and reviewed product-account links in each backend.
Runtime JSON contains public endpoint/client identifiers only. Never put bearer
credentials, infrastructure keys or passwords in it.

Suite runtime requires an Oathweave identity configuration and a public client for
each configured product. A missing runtime file or missing identity fails before
sign-in. Explicit `mode: "legacy"` is reserved for standalone recovery against
the retained native console API; suite installations never select it implicitly.
That mode keeps its unfiltered navigation. The legacy `links.magnus` runtime key is accepted and
ignored for one release.

### Installed products

There are sections only for installed products. The Hive Registry, one installation's install
catalog, is the source of which products those are when it is reachable. `runtime.json` stays the
bootstrap, with API prefixes and OAuth clients, so a section shows only for a product that it
configures and the Registry lists. The console reads the Registry's public `/api/registry` routes
anonymously. If they fail, send something unreadable or list no configured product, it follows
`runtime.json` and warns on the overview. The Hive overview, Incidents, API Docs and Settings cover
and call only installed products. A bookmark to an absent product opens the overview.

## Credentials

Access tokens live only in memory; replacement credentials use the server-owned SSO cookie. Chat
exchanges a resource credential for a short native cookie and uses that cookie for attachments and
WebSockets. Nothing puts credentials in URLs or browser storage. Bearer-authorized API requests omit
browser cookies. Shared ingress must also strip Oathweave's SSO and refresh cookies from other
products and reject those products' attempts to set identity cookies; this also covers native
WebSocket and attachment requests that necessarily include cookies.

Recovery codes and MFA setup material stay in memory and disappear when dismissed or on navigation.

## Contracts

Contracts are browser-safe files owned by this checkout. They do not import a sibling backend. Their
provenance records the original public source revision. `npm run check:contracts` checks the
reviewed artifacts; each producer separately checks source/export drift. A released contract
publication and drift pipeline remains part of migration work.

Identity administration, account security and enrollment use a reviewed immutable Oathweave browser
export. Skills uses the equivalent owning-product export. These standalone Zod modules are pinned by
version and checksum, preserve native request refinements, and import only Zod.

Memory and workspace administration use the reviewed immutable HiveMem OpenAPI artifact in
`contracts/`, pinned by source revision and checksum with license and notice attribution. The check
covers provenance and generated browser validators, including URL and array limits.

Hive has no browser contract export for the Registry yet, so `contracts/hive-registry` is pinned
locally to a source revision and checksum.

Models, routing policies and revisions, inference tests and previews, client-key management and
quota usage, telemetry and traces, audit, settings, API docs and Codex authorization use Emberpath's
reviewed browser-safe request and response contract export. The check verifies its exact source
checksum, public provenance, product version and immutable source revision. Request types and runtime
validation come from that vendored artifact, including the distinct model read-to-write conversion.
The original Apache license and notice are retained in `notices/`.

## Module notes

### Memory

Memory browsing sends the native `offset` query parameter. Every dashboard response is validated
before browser aggregation. Memory writes, queue administration and workspace ownership are checked
independently; the owning API enforces them when console controls are bypassed. Archived workspace
IDs remain reserved, and restoration preserves existing ownership, membership and stored memories.

Open **Memories → Open memory operations** for session creation, metadata editing, current memory
history, source-cited context/chat and session archival; workspace webhook creation, editing,
archival, signing-secret rotation, test emission and paginated delivery history; graph neighborhoods,
entities, relations and source evidence; unresolved conflict review; consolidation
scheduling/history; and queue inspection, run, retry and pre-execution cancellation. The workspace
selector limits each operation. Product scopes govern reads and mutations independently; HiveMem also
checks current ownership and workspace permissions when UI controls are bypassed.

The module consumes HiveMem's owned OpenAPI snapshot and generated browser schemas. It calls product
APIs directly using the resource token held in memory. Webhook signing secrets are submitted only to
HiveMem and cleared from the form on success; existing secrets are never returned. Tests emit to all
enabled endpoints owned by the caller in the selected workspace. Delivery acceptance means queued,
with actual HTTPS outcomes visible in history. Consolidation uses an explicit durable operation ID
and retains that ID for retry after a failed response. Check the original queue record before
creating replacement work after a browser reload.

Deep links use `?page=memories&memoryTab=sessions&workspace=default` (also `webhooks`, `graph`,
`conflicts`, `consolidation`, `queue`); optional `session` and `webhook` IDs reopen permitted
records. Disabled operations explain the missing product permission. These workflows do not certify a
production migration or enable cutover.

### Chat

Chat invites are redeemed at `/signup`, the one console page that needs no sign-in. It creates a
native ChatterMost account for Mattermost-compatible apps through the product's public signup route.
Using chat in this console also needs an Oathweave account with `chattermost:session` and a reviewed
entry in `OATHWEAVE_CHAT_IDENTITIES_JSON`; redeeming an invite creates neither, and nothing matches
accounts by name or email.

Chat administration is available to the effective ChatterMost system administrator through **Open
administration**. Task sections cover native users, invitations, password/session recovery, reviewed
test cleanup, privacy, custom emoji, supervision decisions and history, agent policy
registrations/simulation, Hermes health and bot credentials. Administrative APIs enforce
authorization independently. The policy simulator displays the product's preview; it does not certify
an agent's actual authority.

Deep links add `chatAdmin=users`, `system`, `supervision`, `agents` or `hermes` to `?page=chat`. Bot
credential changes require the released caller-bound receipt capability. Create only refuses existing
usernames; identity edits preserve tokens. A non-secret, administrator-bound operation ID is saved in
session storage before a mutation. Interrupted requests are reconciled through a read-only receipt
and are never automatically repeated. A missing receipt holds further credential changes for review.
Revealed bot tokens and invitation codes stay in memory and clear on section changes, page hiding,
timeout or explicit clearing. If a token response is lost, acknowledge the committed receipt before
explicitly rotating a replacement and updating the owning agent's protected configuration.

### Magnus

With `magnus` in `products`, the fleet console is the module at `/fleet`, signed in through Oathweave
like every other product. See `src/modules/magnus/PORTING.md`.

### Ardent Project Studio

With `ardentstudio` in `products`, the Studio entries open `/studio/*` as a fullscreen page outside
the console shell, with its own top bar. You write a project brief, design a team and bind each role
to a Magnus-managed Ardent agent, talk to the team in a Conversation Room where replies stream live,
tune each agent in Agent Studio and review what it delivers. **Close Studio** (✕) returns to the
console page it was opened from, kept in `history.state`, or to the suite home; Escape does not close
it. Each area has a **?** guide in the top bar.

Studio needs the ArdentStudio service at `/api/ardentstudio`, Magnus with at least one reachable
Ardent agent, HiveMem for project knowledge and Oathweave for sign-in. Creating an agent and applying
changes to one also need a Magnus ADMIN. [docs/STUDIO.md](docs/STUDIO.md) covers the routes, each
area's workflows, the room's agent states, the keyboard map, accessibility and known limits.

#### End-to-end tests

`npm run e2e` runs the Studio acceptance scenarios (`e2e/studio/*.spec.ts`: an adventure and a
research project, through the Studio API and in the browser) against a real stack built from the
product checkouts next to this one: Oathweave, HiveMem, Magnus (server, PostgreSQL, Redis and one
node agent in a systemd container that manages Ardent gateways), ArdentStudio and this console
behind Hive's ingress configuration (`../Hive/deployment/Caddyfile`). The only fixture is the model:
`e2e/stack/model/server.mjs`, a deterministic OpenAI-compatible streaming server with scripted
replies and mission tool calls. Every secret and certificate is generated per run.

```bash
npm run e2e:stack -- up      # build the images (once), start, enroll the node, deploy two agents
npm run e2e -- --trace off   # the specs; they start the stack themselves when none is running
npm run e2e:stack -- down    # remove the stack's containers, volumes and run directory
```

Docker with Compose is required; without it the specs are skipped, so `npm run e2e` stays green
where Docker is unavailable. The stack uses the compose project `studio-e2e`, publishes only the
console on a free loopback port and keeps its state in `output/studio-e2e/`; screenshots go to
`output/studio-e2e-shots/` (or `STUDIO_E2E_SHOTS`). `STUDIO_E2E_PRODUCTS_ROOT` points at another
directory of checkouts, `STUDIO_E2E_MAGNUS_DIR` at another Magnus checkout,
`STUDIO_E2E_ARDENT_TGZ` at an Ardent package to stage on the node instead of one packed from
`../Ardent`, `STUDIO_E2E_REBUILD=1` rebuilds the images and `STUDIO_E2E_TAG` names their tag (default
`local`), so stacks built from different checkouts keep their own images. `STUDIO_E2E_KEEP=1` keeps a
stack the specs started. The bootstrap activates the node's Ardent-only scope over the evidence Magnus's
ADMIN API reports (`GET /resource-leases/enrollment/:nodeId/ardent-scope/evidence`), and the stack sets
`COMMAND_RECONCILIATION_SECRET` on Magnus and the node agent, so an Ardent action whose outcome is
unknown can be reconciled from the Ardent installations page. The node container runs systemd and
needs `CAP_SYS_ADMIN` in a private cgroup namespace; it never touches the host's cgroups.

### Sign-in portal

The central `/auth/authorize` portal accepts standard Code with S256 PKCE requests for explicitly
registered Oathweave public clients. It reuses sign-in, MFA and consent, validates state/nonce and the
configured issuer, and returns only the backend-issued code to the exact registered HTTPS callback.
The requesting application's backend retains its verifier and performs token exchange. Unknown or
repeated parameters, unsafe callbacks and declined access remain local errors; the portal does not
redirect errors to unvalidated targets. Authorization requests and one-use continuations live only in
memory and are invalidated on logout or session invalidation. Existing suite sign-in and console deep
links retain their original behavior.
