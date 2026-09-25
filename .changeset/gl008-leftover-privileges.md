---
'supabase-grants-lint': minor
---

Add rule GL008 (leftover-privileges): warns when a table or view created in a checked migration still gives `anon`, `authenticated` or a role in `clientRoles` TRUNCATE, REFERENCES or TRIGGER at the end of that migration, own or through `PUBLIC`. The opt-in SQL Supabase announced revokes only select, insert, update and delete, so the old `grant all` default leaves these behind; the Data API never needs them, and TRUNCATE and REFERENCES are not subject to row level security. MAINTAIN is checked too when `postgresMajor` is 17 or later, since it does not exist before Postgres 17. One finding per relation; the fix revokes them from the roles that hold them (and from `public` when granted through it).
