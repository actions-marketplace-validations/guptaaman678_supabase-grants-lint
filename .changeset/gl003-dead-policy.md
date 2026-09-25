---
'supabase-grants-lint': minor
---

Add rule GL003 (dead-policy): flags an RLS policy created or altered in an enforced migration whose role (`anon`, `authenticated`, `PUBLIC`, or a role in `clientRoles`) holds no privilege the policy's command needs by the end of the migration (any select, insert, update or delete for `ALL`), with the grant that makes it apply. A policy on a table no migration creates is reported as a warning.
