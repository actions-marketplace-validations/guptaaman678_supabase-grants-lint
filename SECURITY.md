# Security policy

## Supported versions

`supabase-grants-lint` is a static analysis CLI: it does not connect to a
database or network in `check`, `doctor`, `explain` or `init` (v0.1). Security
fixes are released against the latest `0.x` minor version. Once 1.0.0 ships,
the latest major version receives security fixes.

| Version    | Supported |
| ---------- | --------- |
| latest 0.x | yes       |
| older 0.x  | no        |

## Reporting a vulnerability

Please do not open a public issue for a security report. Use [GitHub's
private vulnerability reporting](https://github.com/guptaaman678/supabase-grants-lint/security/advisories/new)
for this repository.

Include, where possible: the version affected, the minimal SQL or
configuration that reproduces the issue, and the impact you expect (for
example, a false negative that would hide a real grants problem).

You should expect a first response within 7 days. Confirmed vulnerabilities
are fixed in a patch release and credited in the release notes unless you ask
otherwise.

## Scope

In scope: the CLI, the programmatic API, the GitHub Action, and the
pre-commit hook, as published from this repository. Out of scope: the
Supabase platform itself, and any database `supabase-grants-lint` did not
connect to (v0.1 never connects to a database).
