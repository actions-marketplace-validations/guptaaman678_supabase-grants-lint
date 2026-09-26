---
'supabase-grants-lint': minor
---

Add the `check` command and the CLI contract: `--dir`, `--config`, `--since`, repeatable `--schema`, `--max-warnings`, `--strict-parse`, `--quiet` and `--no-color`, with `--help` per command and examples. Exit codes: 0 no errors and warnings within `--max-warnings`, 1 findings over the threshold, 2 usage or config error (an unknown flag or command suggests the closest one), 3 internal error or unparseable SQL under `--strict-parse`. Colour is used only on a terminal and never when `NO_COLOR` is set. The parser loads only for commands that lint. The package root exports `lint(options)`, which returns the findings, notices and a summary.
