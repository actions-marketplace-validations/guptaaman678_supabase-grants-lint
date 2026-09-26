---
'supabase-grants-lint': minor
---

Add the `--format` reporters for `check`. `pretty` (the default) groups findings by file with the fix and docs link aligned under each rule. `json` prints `{ schemaVersion: 1, tool, summary, findings, notices }`, and the summary includes the resolved `since` (value, where it came from, and the detected opt-in migration). `sarif` writes SARIF 2.1.0 with one rule descriptor per rule, for GitHub code scanning. `github` prints workflow commands, so each finding becomes an annotation on the migration line in a GitHub Actions run. `--quiet` lists error findings only in every format; the summary still counts everything.
