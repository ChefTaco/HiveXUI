# HiveXUI

HiveXUI is the shared browser console for the Hive:Magnus suite: one sign-in and one navigation across identity, models, memory, Skills, security and chat. It is a static React application. Every operation goes to the owning product's API with the signed-in user's own credentials.

It is one product in the [Hive:Magnus](https://github.com/ChefTaco/hive) suite. The [Hive installer](https://github.com/ChefTaco/hive#readme) deploys tested combinations of the suite's products.

This project was extracted from Hive with its migration history and client protocols intact. `provenance.json` records the source revision and original file hashes.

Build with `npm ci --ignore-scripts && npm run build`; run the browser boundary
regressions with `npm test`. `Dockerfile` serves only compiled assets as UID 101.
The web container has no application backend, database client, signing keys or
infrastructure credentials. Configure HTTPS and API routing in a separate ingress.

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
    "chattermost": "/api/chattermost"
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
      "chattermost": "hivexui-chattermost"
    }
  }
}
```

Register every selected public client and its exact
`https://console.example.com/auth/callback` redirect URI in Oathweave. Configure
resource permission ceilings and reviewed product-account links in each backend.
Runtime JSON contains public endpoint/client identifiers only. Never put bearer
credentials, infrastructure keys or passwords in it. Access tokens live only in
memory; replacement credentials use the server-owned SSO cookie. Chat exchanges a
resource credential for a short native cookie and uses that cookie for attachments
and WebSockets. Nothing puts credentials in URLs or browser storage.
Bearer-authorized API requests omit browser cookies. Shared ingress must also
strip Oathweave's SSO and refresh cookies from other products and reject those
products' attempts to set identity cookies; this also covers native WebSocket and
attachment requests that necessarily include cookies.

Contracts are browser-safe files owned by this checkout. They do not import a
sibling backend. Their provenance records the original public source revision.
A released contract publication/drift pipeline remains part of migration work.

Chat invites are redeemed at `/signup`, the one console page that needs no sign-in. It
creates a native ChatterMost account for Mattermost-compatible apps through the product's
public signup route. Using chat in this console also needs an Oathweave account with
`chattermost:session` and a reviewed entry in `OATHWEAVE_CHAT_IDENTITIES_JSON`; redeeming
an invite creates neither, and nothing matches accounts by name or email.

The security module ports the existing investigation pages and approval controls;
the chat module includes channels, DMs, threads, files, search, message editing,
reactions and realtime refresh. These are candidate ports. Authentication controls include passkeys, consent, recovery, step-up and MFA.
Complete administration, memory and Skills parity and live integration acceptance
are still required. Keep existing native frontends and clients available.
Synthetic browser renders do not establish backend authorization or workflow parity.


Runtime `products` decide what the console shows. Navigation has one section per
installed product plus Hive and System, and the Hive overview, Incidents, API Docs and
Settings cover and call only installed products. A bookmark to an absent product opens
the overview. Actors needs Oathweave, Emberpath and HiveMem because each enrollment
links all three.

With `magnus` in `products`, the fleet console is the module at `/fleet`, signed in through
Oathweave like every other product. See `src/modules/magnus/PORTING.md`. The legacy
`links.magnus` runtime key is accepted and ignored for one release.

Suite runtime requires an Oathweave identity configuration and a public client for
each configured product. A missing runtime file or missing identity fails before
sign-in. Explicit `mode: "legacy"` is reserved for standalone recovery against
the retained native console API; suite installations never select it implicitly.
That mode keeps its unfiltered navigation.
Identity administration, account security and enrollment use a reviewed immutable
Oathweave browser export. Skills uses the equivalent owning-product export. These
standalone Zod modules are pinned by version and checksum, preserve native request
refinements, and import only Zod. `npm run check:contracts` checks the reviewed
artifacts; each producer separately checks source/export drift. These local
candidate contracts remain unpublished pending independent product releases. Recovery codes and
MFA setup material stay in memory and disappear when dismissed or on navigation.

The Hive Registry is the mandatory install catalog of one installation. `runtime.json` stays the
bootstrap, with API prefixes and OAuth clients, and a section shows only for a product that it
configures and the Registry lists. The console reads the Registry's public `/api/registry` routes
anonymously. If they fail, send something unreadable or list no configured product, it follows
`runtime.json` and warns on the overview. Hive has no browser contract export for the Registry yet,
so `contracts/hive-registry` is pinned locally to a source revision and checksum.

Memory and workspace administration use the reviewed immutable HiveMem OpenAPI
artifact in `contracts/`, pinned by source revision and checksum with license and
notice attribution. `npm run check:contracts` checks provenance and generated
browser validators for drift, including URL and array limits. Memory browsing sends
the native `offset` query parameter. Every dashboard response is validated before
browser aggregation. Memory writes,
queue administration and workspace ownership are checked independently; the owning
API enforces them when console controls are bypassed. Archived workspace IDs remain
reserved, and restoration preserves existing ownership, membership and stored memories.


### Memory workflow coverage

Open **Memories → Open memory operations** for session creation, metadata editing,
current memory history, source-cited context/chat and session archival; workspace
webhook creation, editing, archival, signing-secret rotation, test emission and
paginated delivery history; graph neighborhoods, entities, relations and source
evidence; unresolved conflict review; consolidation scheduling/history; and queue
inspection, run, retry and pre-execution cancellation. The workspace selector limits
each operation. Product scopes govern reads and mutations independently; HiveMem
also checks current ownership and workspace permissions when UI controls are bypassed.

The module consumes HiveMem's owned OpenAPI snapshot and generated browser schemas.
It calls product APIs directly using the resource token held in memory. Webhook
signing secrets are submitted only to HiveMem and cleared from the form on success;
existing secrets are never returned. Tests emit to all enabled endpoints owned by
the caller in the selected workspace. Delivery acceptance means queued, with actual
HTTPS outcomes visible in history. Consolidation uses an explicit durable operation
ID and retains that ID for retry after a failed response. Check the original queue
record before creating replacement work after a browser reload.

Deep links use `?page=memories&memoryTab=sessions&workspace=default` (also `webhooks`,
`graph`, `conflicts`, `consolidation`, `queue`); optional `session` and `webhook` IDs
reopen permitted records. Disabled operations explain the missing product permission.
Legacy frontends remain available until restored-data and authenticated browser parity
checks pass. These workflows do not certify a production migration or enable cutover.

Chat administration is available to the effective ChatterMost system administrator
through **Open administration**. Task sections cover native users, invitations,
password/session recovery, reviewed test cleanup, privacy, custom emoji,
supervision decisions and history, agent policy registrations/simulation, Hermes
health and bot credentials. Administrative APIs enforce authorization independently.
The policy simulator displays the product's preview; it does not certify an agent's
actual authority. Existing native Chat clients and the recovery web console remain.

Deep links add `chatAdmin=users`, `system`, `supervision`, `agents` or `hermes` to
`?page=chat`. Bot credential changes require the released caller-bound receipt
capability. Create only refuses existing usernames; identity edits preserve tokens.
A non-secret, administrator-bound operation ID is saved in session storage before
a mutation. Interrupted requests are reconciled through a read-only receipt and
are never automatically repeated. A missing receipt holds further credential
changes for review. Revealed bot tokens and invitation codes stay in memory and
clear on section changes, page hiding, timeout or explicit clearing. If a token
response is lost, acknowledge the committed receipt before explicitly rotating a
replacement and updating the owning agent's protected configuration.

Models, routing policies and revisions, inference tests and previews, client-key
management and quota usage, telemetry and traces, audit, settings, API docs and
Codex authorization use Emberpath's reviewed browser-safe request and response
contract export. `check:contracts` verifies its exact source checksum, public provenance,
product version and immutable source revision. Request types and runtime
validation come from that vendored artifact, including the distinct model
read-to-write conversion. The original Apache license and notice are retained in
`notices/`; frontend code never imports a sibling backend implementation.

The central `/auth/authorize` portal accepts standard Code with S256 PKCE
requests for explicitly registered Oathweave public clients. It reuses sign-in,
MFA and consent, validates state/nonce and the configured issuer, and returns
only the backend-issued code to the exact registered HTTPS callback. The
requesting application's backend retains its verifier and performs token exchange.
Unknown or repeated parameters, unsafe callbacks and declined access remain local
errors; the portal does not redirect errors to unvalidated targets. Authorization
requests and one-use continuations live only in memory and are invalidated on
logout or session invalidation. Existing suite sign-in and console deep links
retain their original behavior.
