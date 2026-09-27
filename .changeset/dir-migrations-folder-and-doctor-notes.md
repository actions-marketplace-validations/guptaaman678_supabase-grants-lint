---
'supabase-grants-lint': patch
---

`--dir` now also accepts the migrations folder itself: when the directory has no `supabase/migrations` but holds `.sql` files, those files are the migrations (for example `check --dir db/migrations`). `doctor` names the relations that the migrations grant on, revoke on or add policies to but never create (usually tables made in the dashboard), since `check` cannot see them, and an opt-in migration with nothing after it now reads "No migrations after it yet; check will enforce every new one".
