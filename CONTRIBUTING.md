# Contributing

Thanks for considering a contribution to `supabase-grants-lint`.

## Setup

```
git clone https://github.com/guptaaman678/supabase-grants-lint.git
cd supabase-grants-lint
npm ci
npm run build
npm test
```

Node `>=22` is required (`.nvmrc` pins the version used in development).

## Commands

| Command                           | Purpose                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `npm run build`                   | build the CLI and library with tsup                                           |
| `npm test`                        | run the vitest suite                                                          |
| `npm run test:watch`              | run tests in watch mode                                                       |
| `npm run lint`                    | ESLint                                                                        |
| `npm run typecheck`               | `tsc --noEmit` in strict mode                                                 |
| `npm run format` / `format:check` | Prettier                                                                      |
| `npm run mutation`                | Stryker mutation testing on `src/model`, `src/replay`, `src/rules`, `src/fix` |
| `npm run bench`                   | performance benchmark                                                         |

## Fixture layout

Behavioural tests live under `test/fixtures/<RULE>/<pass|fail>/<case>/`:

```
test/fixtures/GL001/fail/no-service-role-grant/
  migrations/0001_create_table.sql
  expected.json
  config.json   (optional, only if the case needs non-default config)
```

`expected.json` lists the exact findings the fixture produces: rule, file,
line, relation and role. A fixture with no matching finding belongs under
`pass/`.

## Reporter golden files

Every `--format` is checked against golden files: each project in
`test/golden/projects/` is linted and its output compared with
`test/golden/<format>/<project>.txt`. After an intentional output change,
rewrite them and review the diff before committing:

```sh
UPDATE_GOLDEN=1 npx vitest run test/golden/reporters.test.ts
git diff test/golden
```

SARIF output is also validated against the SARIF 2.1.0 schema vendored in
`test/golden/sarif-schema-2.1.0-rtm.5.json`.

## How to add a rule

1. Read the rule's semantics in `docs/rules/` (or draft the page first if the
   rule does not exist yet).
2. Implement `src/rules/<ID>.ts` against the `Rule` interface in
   `src/rules/types.ts`. A rule reads the end-of-file snapshot; it never
   mutates the model.
3. Add fixtures: at least one failing case, one passing case, and one case
   for every exemption or edge condition named in the rule's spec.
4. Add `docs/rules/<ID>.md`.
5. Run `npm run mutation` and either add a test for every surviving mutant in
   the rule's file, or record why the mutant is equivalent below.
6. Add a changeset (`npx changeset`) describing the user-visible change.

## Commits and releases

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
and [Changesets](https://github.com/changesets/changesets). Every
user-visible change needs a changeset (`npx changeset`); internal-only changes
do not. Releases follow SemVer and stay `0.x` until the project's stability
promise is published.

## Triage expectations

Reports are triaged in the order: internal errors and crashes, then false
positives and parser failures, then everything else. The target first
response time and the policy for closing issues are documented in the
project's maintenance policy once it is published; until then, expect a reply
within a few days.

## Mutation notes

Surviving mutants judged equivalent (no behavioural difference, so no
additional test is added) are recorded here as they are found. Empty for now.
