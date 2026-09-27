---
'supabase-grants-lint': patch
---

The pre-commit hook (`.pre-commit-hooks.yaml`) is not included in this release: `pre-commit`'s node-language installer builds the hook repo as a nested `file:` dependency of a throwaway root, so a build-time devDependency (the bundler) never installs, and `entry: supabase-grants-lint check` fails before it runs. Use the GitHub Action or the CLI directly for now; a `language: system` hook is planned once the package is published on npm.
