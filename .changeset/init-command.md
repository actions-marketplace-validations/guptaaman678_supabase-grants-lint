---
'supabase-grants-lint': minor
---

Add `init`, which writes `grants-lint.config.json` (with `$schema` for editor help) and `.github/workflows/grants-lint.yml` (runs the GitHub Action on pull requests and pushes to `main`). `--since next` sets `since` to the latest migration version, so `check` enforces only the migrations you add from now on; `--since <version>` or `--since none` set it directly, and without `--since` it is `"auto"`. `--no-workflow` writes only the config, and `--dir` writes into another project. `init` never overwrites a file: if one exists it writes nothing and exits 2, unless you pass `--force`.
