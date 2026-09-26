---
'supabase-grants-lint': minor
---

Add `doctor`, a readiness report for 2026-10-30 in four sections. Opt-in status: the opt-in migration it detected, or the `since` you set. Replay trap: whether the migrations turn automatic grants back on when replayed (GL007), and whether `supabase/config.toml` sets `[api] auto_expose_new_tables = false`. History exposure: the relations your migrations create that a database without automatic grants could not reach through the Data API. Next steps: the opt-in SQL, the fixes, and the `init` command. `doctor` takes the same `--dir`, `--config`, `--since` and `--schema` options as `check`, fits 100 columns, and exits 0 whatever it finds.
