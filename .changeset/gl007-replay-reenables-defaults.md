---
'supabase-grants-lint': minor
---

Add rule GL007 (replay-reenables-defaults): reports when the migrations themselves, replayed from the first file to the last, leave `alter default privileges` grants that give `anon`, `authenticated`, `PUBLIC`, a role in `clientRoles`, or the service role privileges on new tables or sequences the migration role creates in a checked schema. A replay (`supabase db reset`, a preview branch) then grants new relations what production, with automatic grants off, does not. Only statements in the files count, not `platformDefaults`. The finding is a warning at the last statement that granted something still in effect, or an error when `since` was auto-detected and that statement comes after the opt-in migration. The fix revokes the defaults in a new migration.
