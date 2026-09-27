import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_URL, WORKFLOW, WORKFLOW_PATH } from '../../src/cli/commands/init.js';
import { ExitCode } from '../../src/cli/exit-codes.js';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import { loadConfig } from '../../src/config/load.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'grants-lint-init-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fakeIo(cwd = dir) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd,
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function init(args: string[] = [], cwd = dir) {
  const { io, stdout, stderr } = fakeIo(cwd);
  const code = await run(['init', ...args], io);
  return { code, stdout: stdout(), stderr: stderr() };
}

const read = (rel: string) => readFileSync(path.join(dir, rel), 'utf8');
const config = () => JSON.parse(read('grants-lint.config.json')) as Record<string, unknown>;

function migration(name: string, sql = 'create table public.todos (id bigint);\n') {
  mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
  writeFileSync(path.join(dir, 'supabase/migrations', name), sql);
}

describe('init in a fresh project', () => {
  it('writes the config with $schema and the workflow', async () => {
    expect(await init()).toEqual({
      code: ExitCode.Ok,
      stdout:
        'Wrote grants-lint.config.json (since auto)\n' +
        `Wrote ${WORKFLOW_PATH}\n\n` +
        'Next: run supabase-grants-lint check, then commit these files.\n',
      stderr: '',
    });
    expect(read('grants-lint.config.json')).toBe(
      `{\n  "$schema": "${SCHEMA_URL}",\n  "since": "auto"\n}\n`,
    );
    expect(read(WORKFLOW_PATH)).toBe(WORKFLOW);
  });

  it('writes a config the loader accepts', async () => {
    migration('20261001000000_add_todos.sql');
    expect((await init(['--since', 'next'])).code).toBe(ExitCode.Ok);
    expect(loadConfig({ cwd: dir }).config.since).toBe('20261001000000');
  });

  it('points the $schema at the published schema file', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../schema/config.schema.json', import.meta.url), 'utf8'),
    ) as { $id: string };
    expect(SCHEMA_URL).toBe(schema.$id);
  });

  it('uses the Action at the floating major tag', () => {
    expect(WORKFLOW).toContain('      - uses: guptaaman678/supabase-grants-lint@v0\n');
    expect(WORKFLOW).toContain('  security-events: write\n');
    expect(WORKFLOW).not.toContain(String.fromCharCode(0x2014));
  });

  it('writes only the config with --no-workflow', async () => {
    const result = await init(['--no-workflow']);
    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).not.toContain(WORKFLOW_PATH);
    expect(() => read(WORKFLOW_PATH)).toThrow();
    expect(config()).toEqual({ $schema: SCHEMA_URL, since: 'auto' });
  });

  it('writes into --dir, relative to the working directory', async () => {
    mkdirSync(path.join(dir, 'apps/api'), { recursive: true });
    const result = await init(['--dir', 'apps/api']);
    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toContain('Wrote apps/api/grants-lint.config.json (since auto)\n');
    expect(read(`apps/api/${WORKFLOW_PATH}`)).toBe(WORKFLOW);
  });
});

describe('init --since', () => {
  it('next: the latest versioned migration, ignoring files without a version', async () => {
    migration('20261002000000_b.sql');
    migration('20261001000000_a.sql');
    migration('seed.sql');
    const result = await init(['--since', 'next']);
    expect(result.stdout).toContain('Wrote grants-lint.config.json (since 20261002000000)\n');
    expect(config().since).toBe('20261002000000');
  });

  it('next: reads the migrations location from package.json#grantsLint', async () => {
    writeFileSync(path.join(dir, 'package.json'), '{"grantsLint":{"migrations":"db"}}');
    mkdirSync(path.join(dir, 'db'));
    writeFileSync(path.join(dir, 'db/7_x.sql'), 'select 1;\n');
    migration('20261001000000_elsewhere.sql');
    expect((await init(['--since=next'])).code).toBe(ExitCode.Ok);
    expect(config().since).toBe('7');
  });

  it.each([['20261001090000'], ['none'], ['auto']])('%s is written as given', async (since) => {
    expect((await init(['--since', since])).code).toBe(ExitCode.Ok);
    expect(config().since).toBe(since);
  });

  it('next without versioned migrations is a usage error', async () => {
    migration('seed.sql');
    const result = await init(['--since', 'next']);
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('--since next needs at least one migration with a version');
    expect(() => read('grants-lint.config.json')).toThrow();
  });

  it('next without a migrations directory is a usage error', async () => {
    const result = await init(['--since', 'next']);
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('Migrations directory not found: supabase/migrations.');
  });

  it('rejects an invalid version, with a suggestion', async () => {
    const result = await init(['--since', '20261001090000_opt_in.sql']);
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain('Invalid config in --since: "since" must be "auto", "none"');
    expect(result.stderr).toContain('Did you mean "20261001090000"?');
    expect(() => read('grants-lint.config.json')).toThrow();
  });
});

describe('init with existing files', () => {
  it('writes nothing and exits 2 when the config exists', async () => {
    writeFileSync(path.join(dir, 'grants-lint.config.json'), '{"since":"none"}\n');
    const result = await init();
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'grants-lint.config.json already exists; nothing was written. Run init --force to overwrite.',
    );
    expect(read('grants-lint.config.json')).toBe('{"since":"none"}\n');
    expect(() => read(WORKFLOW_PATH)).toThrow();
  });

  it('names every existing file', async () => {
    expect((await init()).code).toBe(ExitCode.Ok);
    const result = await init(['--since', 'none']);
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain(
      `grants-lint.config.json, ${WORKFLOW_PATH} already exist; nothing was written.`,
    );
    expect(config().since).toBe('auto');
  });

  it('ignores an existing workflow with --no-workflow', async () => {
    mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(dir, WORKFLOW_PATH), 'mine\n');
    expect((await init(['--no-workflow'])).code).toBe(ExitCode.Ok);
    expect(read(WORKFLOW_PATH)).toBe('mine\n');
  });

  it('overwrites with --force and says so', async () => {
    writeFileSync(path.join(dir, 'grants-lint.config.json'), '{"since":"none"}\n');
    const result = await init(['--force', '--since', '20261001090000']);
    expect(result.code).toBe(ExitCode.Ok);
    expect(result.stdout).toContain(
      'Overwrote grants-lint.config.json (since 20261001090000)\n' + `Wrote ${WORKFLOW_PATH}\n`,
    );
    expect(config()).toEqual({ $schema: SCHEMA_URL, since: '20261001090000' });
    expect(read(WORKFLOW_PATH)).toBe(WORKFLOW);
  });
});

describe('init usage errors', () => {
  it.each([
    [['x'], 'init takes no arguments, got "x".'],
    [['--frce'], 'Unknown option --frce for init. Did you mean "--force"?'],
    [['--dir', 'nope'], 'Project directory not found: nope.'],
    [['--force=yes'], 'Option --force does not take a value.'],
  ])('%j', async (args, message) => {
    const result = await init(args);
    expect(result.code).toBe(ExitCode.Usage);
    expect(result.stderr).toContain(message);
  });
});
