# supabase-grants-lint

[![mutation testing](https://github.com/guptaaman678/supabase-grants-lint/actions/workflows/mutation.yml/badge.svg)](https://github.com/guptaaman678/supabase-grants-lint/actions/workflows/mutation.yml)

Replays your Supabase SQL migrations, works out who can reach every table, and flags migrations that the Data API cannot reach (PostgREST `42501 permission denied for table`) once auto-grants are gone.

Work in progress. Not released yet.

## pre-commit hook

Add to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/guptaaman678/supabase-grants-lint
    rev: v0.1.0
    hooks:
      - id: supabase-grants-lint
```

The hook runs `supabase-grants-lint check` whenever a file under `supabase/migrations/` changes,
against the whole migrations directory (not just the staged files, since a finding can depend on
grants made in an earlier file). See [`.pre-commit-hooks.yaml`](.pre-commit-hooks.yaml).

Not affiliated with or endorsed by Supabase.
