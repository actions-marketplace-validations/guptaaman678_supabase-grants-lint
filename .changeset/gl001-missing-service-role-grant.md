---
'supabase-grants-lint': minor
---

Add rule GL001 (missing-service-role-grant): flags a table or view created in an enforced migration that gives `service_role` no privilege by the end of that migration, with the grant to add. `--help` now lists the implemented rules.
