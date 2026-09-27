/**
 * `init` (spec §6.3): writes `grants-lint.config.json` and a GitHub workflow that runs the Action.
 * It never overwrites a file without `--force`: when any target exists, nothing is written and it
 * exits 2. `--since next` sets `since` to the latest migration version, so check enforces only the
 * migrations added after it. No network (G4), and the parser is never loaded.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../config/load.js';
import { CONFIG_FILE_NAME } from '../../config/defaults.js';
import { validateConfig } from '../../config/validate.js';
import { UsageError } from '../../errors.js';
import { discoverMigrations, toRelPath } from '../../load/discover.js';
import { booleanOption, type OptionSpecs, parseCommandArgs, stringOption } from '../args.js';
import { ExitCode } from '../exit-codes.js';
import type { Io } from '../io.js';
import { COMMAND_USAGE } from '../usage.js';

export const INIT_OPTIONS: OptionSpecs = {
  since: { type: 'string' },
  force: { type: 'boolean' },
  'no-workflow': { type: 'boolean' },
  dir: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

export const SCHEMA_URL =
  'https://raw.githubusercontent.com/guptaaman678/supabase-grants-lint/main/schema/config.schema.json';

export const WORKFLOW_PATH = '.github/workflows/grants-lint.yml';

export const WORKFLOW = `# Written by supabase-grants-lint init. Options:
# https://github.com/guptaaman678/supabase-grants-lint/blob/main/docs/github-action.md
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
`;

/** The latest migration version under the project's configured migrations. */
function latestVersion(cwd: string, projectDir: string): string {
  const { config } = loadConfig({ cwd, projectDir });
  const { files } = discoverMigrations({ migrations: config.migrations, projectDir, cwd });
  const versioned = files.filter((file) => file.version !== null);
  const last = versioned[versioned.length - 1];
  if (last?.version == null) {
    throw new UsageError(
      '--since next needs at least one migration with a version (<version>_<name>.sql). ' +
        'Use --since none to enforce every migration, or --since <version>.',
    );
  }
  return last.version;
}

/** The config `init` writes: `$schema` for editors, and `since` (`"auto"` without `--since`). */
export function initConfig(since: string | undefined): string {
  return `${JSON.stringify({ $schema: SCHEMA_URL, since: since ?? 'auto' }, null, 2)}\n`;
}

export function init(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parseCommandArgs(args, INIT_OPTIONS, 'init');
  if (booleanOption(values, 'help')) {
    io.stdout(COMMAND_USAGE.init);
    return Promise.resolve(ExitCode.Ok);
  }
  if (positionals.length > 0) {
    throw new UsageError(
      `init takes no arguments, got "${positionals.join(' ')}". Use --dir <path> for another project.`,
    );
  }
  const projectDir = path.resolve(io.cwd, stringOption(values, 'dir') ?? '.');
  if (!existsSync(projectDir)) {
    throw new UsageError(`Project directory not found: ${toRelPath(io.cwd, projectDir) || '.'}.`);
  }

  const sinceFlag = stringOption(values, 'since');
  let since: string | undefined;
  if (sinceFlag === 'next') {
    since = latestVersion(io.cwd, projectDir);
  } else if (sinceFlag !== undefined) {
    since = validateConfig({ since: sinceFlag }, '--since').since;
  }

  const targets = [{ rel: CONFIG_FILE_NAME, content: initConfig(since) }];
  if (!booleanOption(values, 'no-workflow')) {
    targets.push({ rel: WORKFLOW_PATH, content: WORKFLOW });
  }
  const files = targets.map((target) => ({ ...target, abs: path.join(projectDir, target.rel) }));

  const force = booleanOption(values, 'force');
  const existing = files.filter((file) => existsSync(file.abs));
  if (existing.length > 0 && !force) {
    const names = existing.map((file) => toRelPath(io.cwd, file.abs)).join(', ');
    throw new UsageError(
      `${names} already ${existing.length === 1 ? 'exists' : 'exist'}; nothing was written. ` +
        'Run init --force to overwrite.',
    );
  }

  const lines = files.map((file, index) => {
    mkdirSync(path.dirname(file.abs), { recursive: true });
    writeFileSync(file.abs, file.content);
    const verb = existing.includes(file) ? 'Overwrote' : 'Wrote';
    const note = index === 0 ? ` (since ${since ?? 'auto'})` : '';
    return `${verb} ${toRelPath(io.cwd, file.abs)}${note}`;
  });
  lines.push('', 'Next: run supabase-grants-lint check, then commit these files.');
  io.stdout(`${lines.join('\n')}\n`);
  return Promise.resolve(ExitCode.Ok);
}
