---
'supabase-grants-lint': minor
---

Add rule GL004 (serial-sequence-usage): flags a table created in an enforced migration with a `serial` column that a client role (`anon`, `authenticated`, or a role in `clientRoles`) can insert into but holds no `usage` on the column's sequence by the end of the migration, with the `grant usage on sequence` that fixes it. Identity columns and uuid keys need no sequence grant.
