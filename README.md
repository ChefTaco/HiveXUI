# HiveXUI

Part of the Hive:Magnus ecosystem. This repository starts from a reviewed public
Hive source snapshot; `provenance.json` records its revision and original hashes.

Extraction is in progress. Existing client protocols and migration history are
retained. The suite SSO/API cutover and production migration are not yet accepted.
Do not replace an existing deployment using this source snapshot alone.


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

The security module ports the existing investigation pages and approval controls;
the chat module includes channels, DMs, threads, files, search, message editing,
reactions and realtime refresh. These are candidate ports. Authentication controls include passkeys, consent, recovery, step-up and MFA.
Complete administration, memory and Skills parity and live integration acceptance
are still required. Keep existing native frontends and clients available.
Synthetic browser renders do not establish backend authorization or workflow parity.


Set optional public runtime `links.magnus` to the existing Magnus HTTPS console
origin to expose its separate fleet navigation link. Credentials, query parameters
and fragments are rejected. Magnus keeps its own authentication and UI until its
later integration; no infrastructure credential is shared through navigation.

Suite runtime requires an Oathweave identity configuration and a public client for
each configured product. A missing runtime file or missing identity fails before
sign-in. Explicit `mode: "legacy"` is reserved for standalone recovery against
the retained native console API; suite installations never select it implicitly.
Account security uses the released, vendored Oathweave contract, with generated
browser-only Zod exports checked by `npm run check:contracts`. Recovery codes and
MFA setup material stay in memory and disappear when dismissed or on navigation.
