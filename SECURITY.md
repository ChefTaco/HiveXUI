# Security Policy

## Supported versions

Security fixes are released for the latest `0.x` version of HiveXUI.

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Report them privately through
[GitHub private vulnerability reporting](https://github.com/ChefTaco/HiveXUI/security/advisories/new).
Please include:

- the affected module (for example Magnus, Studio, chat or sign-in) and version or commit
- steps to reproduce, or a proof of concept
- the impact you expect

You should get an acknowledgement within a few days. Once a fix is available, a GitHub security
advisory will credit you unless you ask not to be named.

## Hardening notes for operators

- Serve the UI and every product API over TLS, through a same-origin ingress.
- `runtime.json` holds public endpoints and OAuth client identifiers only. Never put bearer
  credentials, infrastructure keys or passwords in it.
- The web container serves compiled assets only; it holds no backend, database client or signing
  keys. Each product's API enforces authorization on its own.
