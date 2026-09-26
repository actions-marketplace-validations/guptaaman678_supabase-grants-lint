---
'supabase-grants-lint': minor
---

Add `explain <schema.relation>`, the grant timeline of one relation: every migration line that created it (with the default privileges it received), granted or revoked on it, renamed, moved or dropped it, or created, altered, renamed or dropped one of its policies, followed by its final effective privileges per role and its policies. A renamed relation is found by its old or its new name. A name no migration mentions exits 2 and lists the closest names. `explain` takes the same `--dir`, `--config`, `--since` and `--schema` options as `check`.
