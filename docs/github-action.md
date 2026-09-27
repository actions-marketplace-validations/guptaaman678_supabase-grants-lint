# GitHub Action

`guptaaman678/supabase-grants-lint` is also a composite GitHub Action. It runs the same
`supabase-grants-lint check` you run locally, posts annotations on the changed lines of a pull
request, and uploads a SARIF file so findings also show up in the repository's Security tab.

Not affiliated with or endorsed by Supabase.

## Usage

```yaml
name: Grants lint

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  grants-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: guptaaman678/supabase-grants-lint@v0
```

`supabase-grants-lint init` writes this workflow to `.github/workflows/grants-lint.yml`, next to a
`grants-lint.config.json`.

`permissions.security-events: write` is required for the SARIF upload step; drop it (and set
`sarif: false`, see below) if your repository does not have the Security tab (for example a
private repository on a plan without code scanning).

## Inputs

| Input               | Default                | Meaning                                                                                                                                                                                                                    |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `args`              | `''`                   | Extra arguments passed to `check`, for example `--dir supabase/migrations --since v2`.                                                                                                                                     |
| `format`            | `github`               | Report format for the primary run: `pretty`, `json`, `sarif` or `github`. `github` produces the pull request annotations; the action always makes a separate pass in `json` for the `errors` and `warnings` outputs.       |
| `sarif`             | `true`                 | Also run with `--format sarif` and upload the result with `github/codeql-action/upload-sarif`.                                                                                                                             |
| `working-directory` | `.`                    | Directory to run `supabase-grants-lint` in.                                                                                                                                                                                |
| `version`           | (the action's own tag) | `supabase-grants-lint` version to install. A pinned `@v0.1.2` reference always installs that exact package version; a floating `@v0` reference resolves to the newest `0.x` release, never to unreleased code from `main`. |

## Outputs

| Output       | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| `errors`     | Number of error-severity findings.                        |
| `warnings`   | Number of warning-severity findings.                      |
| `sarif-file` | Path to the generated SARIF file, when `sarif` is `true`. |

## Exit behaviour

The action fails the job (and the check on the pull request goes red) whenever
`supabase-grants-lint check` would exit non-zero: any error finding, or more warnings than
`--max-warnings` if you pass it through `args`. The SARIF upload and the `errors`/`warnings`
outputs still run even when the primary check fails, so a red job still gets full annotations and
a full Security tab report. If the SARIF upload itself cannot complete, for example a fork's pull
request only gets a read-only token, or the repository has no Security tab, that failure does not
fail the job: only the migrations themselves can turn the check red.

## Versioning

Each release moves a floating major tag (`v0` until 1.0, then `v1`) to point at that release, and
the action installs the `supabase-grants-lint` npm package version matching the tag it was invoked
at, never an unreleased build from `main`. Pin an exact tag (`@v0.1.2`) instead of the floating one
if you want fully reproducible CI runs.
