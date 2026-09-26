---
'supabase-grants-lint': minor
---

Add rules GL000 (no-enforcement-baseline), PARSE001 (unparseable-statement) and PARSE002 (dynamic-sql-skipped). GL000 warns once, on the last migration, when no `since` is set and no opt-in migration is found, so the rules that check new relations did not run; it points to `init --since next` for projects opted in from the dashboard or by the 2026-10-30 change. PARSE001 reports, as info, each statement the parser could not read (it is skipped and the replay continues) and each migration file without a version prefix; `--strict-parse` will make it an error. PARSE002 reports, as info, each `DO` block that mentions grants, revokes, tables, policies or default privileges, since the replay cannot run it. When `since` is set, a notice now records the platform revoke assumed before the first checked migration, and grants of privileges that do not apply to the object are reported as notices.
