---
'supabase-grants-lint': minor
---

Add rule GL002 (unreachable-new-relation): flags a table created in an enforced migration that has RLS policies for `anon`, `authenticated` or `PUBLIC` (or a role in `clientRoles`) while that role holds no select, insert, update or delete privilege on it by the end of the migration, with the grant covering the policies' commands.
