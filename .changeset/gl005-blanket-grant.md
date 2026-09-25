---
'supabase-grants-lint': minor
---

Add rule GL005 (blanket-grant): warns about `grant ... on all tables in schema` or `on all sequences in schema` for a checked schema to `anon`, `authenticated`, `PUBLIC`, a role in `clientRoles`, or the service role in an enforced migration. Such a grant re-grants every object that exists at that point, including ones narrowed on purpose, and none created later. The suggested fix grants the same privileges on the objects the migration created, by name.
