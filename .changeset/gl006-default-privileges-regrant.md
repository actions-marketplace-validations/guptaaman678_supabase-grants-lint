---
'supabase-grants-lint': minor
---

Add rule GL006 (default-privileges-regrant): reports `alter default privileges ... grant ... on tables` or `on sequences` to `anon`, `authenticated`, `PUBLIC`, a role in `clientRoles`, or the service role, for the migration role (or the role made current by `set role`), in a checked schema or in every schema, in an enforced migration. Such a statement turns automatic grants back on for every object created afterwards. Remove it and grant on each new relation by name.
