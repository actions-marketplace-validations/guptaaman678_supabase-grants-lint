/**
 * End-to-end tests of the built binary (spec T4.1): builds the package once, then runs
 * `node dist/cli/index.js` in a child process for each exit code of the CLI contract (§6.3).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = path.join(ROOT, 'dist/cli/index.js');
const PROJECTS = 'test/e2e/projects';
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

beforeAll(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/tsup/dist/cli-default.js')], {
    cwd: ROOT,
    stdio: 'ignore',
  });
}, 60_000);

function cli(args: string[], env: Record<string, string> = {}) {
  const inherited = { ...process.env };
  delete inherited.NO_COLOR;
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('exit code 0', () => {
  it('prints the version', () => {
    expect(cli(['--version'])).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: '' });
  });

  it('prints help with commands, examples and rules', () => {
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
      const { code, stdout } = cli(args);
      expect(code).toBe(0);
      expect(stdout).toMatch(/^Usage: supabase-grants-lint <command>/);
      expect(stdout).toContain('Examples:');
      expect(stdout).toMatch(/^ {2}GL001 +missing-service-role-grant +error$/m);
    }
  });

  it('prints help per command', () => {
    for (const command of ['check', 'doctor', 'explain', 'init']) {
      const { code, stdout } = cli([command, '--help']);
      expect(code).toBe(0);
      expect(stdout).toMatch(new RegExp(`^Usage: supabase-grants-lint ${command}`));
    }
  });

  it('checks a project without findings', () => {
    const { code, stdout, stderr } = cli(['check', '--dir', `${PROJECTS}/clean`]);
    expect(stderr).toBe('');
    expect(stdout).toMatch(/^0 errors, 0 warnings {2}\(2 files, 1 relation, [0-9.]+s\)\n$/);
    expect(code).toBe(0);
  });

  it('allows warnings when --max-warnings is not given or not exceeded', () => {
    expect(cli(['check', '--dir', `${PROJECTS}/warnings`]).code).toBe(0);
    expect(cli(['check', '--dir', `${PROJECTS}/warnings`, '--max-warnings', '1']).code).toBe(0);
  });

  it('reports unparseable SQL as info without --strict-parse', () => {
    const { code, stdout } = cli(['check', '--dir', `${PROJECTS}/unparseable`]);
    expect(stdout).toMatch(/6:1 +info +PARSE001/);
    expect(code).toBe(0);
  });
});

describe('exit code 1', () => {
  it('fails on an error finding', () => {
    const { code, stdout } = cli(['check', '--dir', `${PROJECTS}/errors`]);
    expect(stdout).toMatch(/1:1 +error +GL001 +public\.todos is created without a grant/);
    expect(stdout).toContain(
      'fix   grant select, insert, update, delete on public.todos to service_role;',
    );
    expect(stdout).toMatch(/^1 error, 0 warnings/m);
    expect(code).toBe(1);
  });

  it('fails when warnings exceed --max-warnings', () => {
    const { code, stdout } = cli(['check', '--dir', `${PROJECTS}/warnings`, '--max-warnings=0']);
    expect(stdout).toMatch(/7:1 +warn +GL005/);
    expect(code).toBe(1);
  });

  it('still fails under --quiet, which prints errors only', () => {
    const errors = cli(['check', '--dir', `${PROJECTS}/errors`, '--quiet']);
    expect(errors.code).toBe(1);
    expect(errors.stdout).toContain('GL001');
    const warnings = cli(['check', '--dir', `${PROJECTS}/warnings`, '--quiet']);
    expect(warnings.stdout).not.toContain('GL005');
    expect(warnings.code).toBe(0);
  });
});

describe('exit code 2', () => {
  it.each([
    [['check', '--frmat', 'json'], 'Unknown option --frmat for check. Did you mean "--format"?'],
    [['chek'], 'Unknown command "chek". Did you mean "check"?'],
    [['--verison'], 'Unknown option --verison for supabase-grants-lint. Did you mean "--version"?'],
    [['check', '--format', 'yaml'], 'must be one of pretty, json, sarif, github, got "yaml"'],
    [['check', '--format'], 'Option --format needs a value.'],
    [['check', '--quiet=yes'], 'Option --quiet does not take a value.'],
    [['check', '--max-warnings', 'ten'], '--max-warnings must be a whole number'],
    [['check', '--since', 'yesterday'], 'Invalid config in --since'],
    [['check', 'supabase'], 'check takes no arguments'],
    [['check', '--dir', 'no/such/project'], 'Migrations directory not found'],
    [['check', '--dir', `${PROJECTS}/bad-config`], 'Did you mean "platformDefaults"?'],
    [['check', '--dir', `${PROJECTS}/clean`, '--config', 'missing.json'], 'file not found'],
  ])('%j', (args, message) => {
    const { code, stdout, stderr } = cli(args);
    expect(stdout).toBe('');
    expect(stderr).toContain(message);
    expect(stderr).toContain('Run "supabase-grants-lint --help" for usage.');
    expect(code).toBe(2);
  });
});

describe('exit code 3', () => {
  it('fails on unparseable SQL under --strict-parse', () => {
    const { code, stdout } = cli(['check', '--dir', `${PROJECTS}/unparseable`, '--strict-parse']);
    expect(stdout).toMatch(/6:1 +error +PARSE001/);
    expect(code).toBe(3);
  });
});

describe('output', () => {
  it('has no colour when output is not a terminal, and none under NO_COLOR', () => {
    const args = ['check', '--dir', `${PROJECTS}/errors`];
    // eslint-disable-next-line no-control-regex
    const ansi = /\u001b\[/;
    expect(cli(args).stdout).not.toMatch(ansi);
    expect(cli(args, { NO_COLOR: '1' }).stdout).not.toMatch(ansi);
    expect(cli([...args, '--no-color']).stdout).not.toMatch(ansi);
  });

  it('loads the parser only for commands that lint', () => {
    const imports = new Set<string>();
    const visit = (file: string): void => {
      if (imports.has(file)) return;
      imports.add(file);
      const source = readFileSync(file, 'utf8');
      // Static imports only: `import ... from "x"` at the start of a line.
      for (const [, spec] of source.matchAll(/^import[^;]*?from\s+"([^"]+)"/gms)) {
        if (spec?.startsWith('.') === true) visit(path.resolve(path.dirname(file), spec));
        else if (spec !== undefined) imports.add(spec);
      }
    };
    visit(BIN);
    expect([...imports]).not.toContain('libpg-query');
    expect(readFileSync(BIN, 'utf8')).toMatch(/import\("\.\.\/lint-[A-Z0-9]+\.js"\)/);
  });
});
