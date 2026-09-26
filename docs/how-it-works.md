# How it works

## Performance

`check` reads every migration file on each run, so its time grows with the history. The target
is under 2 seconds for 100 migration files, measured from a cold start: a fresh Node process that
also loads the Postgres parser.

`npm run bench` builds the CLI, generates synthetic projects with 100 and 500 migration files,
and times `check --format json` on each, one fresh process per run. The generated history starts
with a pulled baseline and the explicit-grants opt-in, then cycles through tables with identity
and serial keys, policies, grants, functions, triggers, views, column changes and a `DO` block,
with some tables left without grants so the rules report findings. The script fails if a run
does not lint every file, or if a 100-file run misses the target.

Measured on 2026-09-26 (Apple M4, 10 cores, 16 GiB, Darwin 25.5.0 arm64, Node 22.16.0; 10 runs per size
after one first run):

| Files | Relations | Median | Slowest | Linting only (median) |
| ----: | --------: | -----: | ------: | --------------------: |
|   100 |        80 | 120 ms |  127 ms |                 57 ms |
|   500 |       400 | 217 ms |  223 ms |                180 ms |

"Linting only" is `summary.durationMs` from the JSON output: config, discovery, parsing, replay
and rules, without process start and parser load. Numbers on your machine will differ; run
`npm run bench` to measure them.
