---
'supabase-grants-lint': minor
---

Add rule GL001 (missing-service-role-grant): flags a table or view created in an enforced migration that gives `service_role` no select, insert, update or delete by the end of that migration, with the grant to add. Truncate, references, trigger and maintain do not count, so GL001 also fires after the platform revoke, which leaves those behind. `--help` now lists the implemented rules.
