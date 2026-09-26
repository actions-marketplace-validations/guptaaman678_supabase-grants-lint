# PARSE001 unparseable-statement

Default severity: **info** (**error** under `--strict-parse`, which also makes `check` exit 3).

## What it catches

- A statement the Postgres parser (the same grammar as Postgres 18) rejects. The replay skips it
  and carries on with the next statement.
- A migration file whose name has no numeric version before the first `_`. Such files replay after
  every versioned file, and the rules that check new relations enforce them only when `since` is
  `"none"`.

PARSE001 checks every file, enforced or not.

## Why it matters

A skipped statement is invisible to the replay. If it created a table or granted privileges, every
later file is checked against a model that is missing it. Usually the statement is not valid SQL
either, and `supabase db reset` fails on it too; the corpus of public projects the tool was tested
on showed nested `$$` quotes, `create policy if not exists` and leftover merge-conflict markers.

## Failing example

```sql
-- supabase/migrations/20261001000000_revoke_automatic_grants.sql
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
```

```sql
-- supabase/migrations/20261002120000_add_todos.sql
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);
grant select, insert, update, delete on public.todos to service_role;
grant select on public.todos to anon, authenticated;
create policy if not exists "Anyone can read todos" on public.todos
  for select using (true);
```

Output of `supabase-grants-lint check`:

```text
supabase/migrations/20261002120000_add_todos.sql
  8:1  info   PARSE001  The replay skipped this statement because it could not be parsed (syntax error at or near "not" (line 8, column 18)), so any grant, table or policy in it is not checked. If Postgres accepts it, please report it as a bug.
              docs  https://github.com/guptaaman678/supabase-grants-lint/blob/v0.1.0/docs/rules/PARSE001.md

0 errors, 0 warnings  (2 files, 1 relation, 0.0s)
```

## Fix

Write the statement in a form Postgres accepts. Postgres has no `create policy if not exists`:

```sql
-- supabase/migrations/20261002120000_add_todos.sql
create table public.todos (
  id bigint generated always as identity primary key,
  title text not null
);
grant select, insert, update, delete on public.todos to service_role;
grant select on public.todos to anon, authenticated;
drop policy if exists "Anyone can read todos" on public.todos;
create policy "Anyone can read todos" on public.todos
  for select using (true);
```

If Postgres accepts a statement the tool reports, please open an issue with the statement.

## When it is safe to disable

When the reported statements are known not to touch tables, grants, policies or default
privileges. In CI, `--strict-parse` is the opposite choice: fail when any statement is skipped.

## Configuration

- `--strict-parse` makes PARSE001 an error and `check` exit 3.
- `"rules": { "PARSE001": "error" }` makes it an error without the exit code 3.
- Suppress one finding with `-- grants-lint-disable-next-line PARSE001: <reason>` on the line
  above the statement, or an [`ignore`](../configuration.md#ignore) entry with a `file`.
