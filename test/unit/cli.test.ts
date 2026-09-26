import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCommandArgs } from '../../src/cli/args.js';
import { type Colors, colorEnabled, colors } from '../../src/cli/color.js';
import { exitCodeFor } from '../../src/cli/commands/check.js';
import { ExitCode } from '../../src/cli/exit-codes.js';
import type { Io } from '../../src/cli/io.js';
import { redact, run } from '../../src/cli/main.js';
import { lint } from '../../src/index.js';
import { formatPretty } from '../../src/report/pretty.js';
import type { Finding } from '../../src/rules/types.js';

const formatText = (result: Parameters<typeof formatPretty>[0], c: Colors, quiet: boolean) =>
  formatPretty(result, { colors: c, quiet });

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PROJECTS = path.join(ROOT, 'test/e2e/projects');

function fakeIo(overrides: Partial<Io> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd: ROOT,
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    ...overrides,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const SPECS = {
  format: { type: 'string' },
  schema: { type: 'string', multiple: true },
  quiet: { type: 'boolean', short: 'q' },
} as const;

describe('parseCommandArgs', () => {
  it('reads strings, repeated strings, switches, short flags and positionals', () => {
    expect(
      parseCommandArgs(
        ['--format', 'json', '--schema', 'a', '--schema=b', '-q', 'x', '--', '--y'],
        SPECS,
        'check',
      ),
    ).toEqual({
      values: { format: 'json', schema: ['a', 'b'], quiet: true },
      positionals: ['x', '--y'],
    });
  });

  it('accepts an inline value that starts with a dash', () => {
    expect(parseCommandArgs(['--format=-x'], SPECS, 'check').values).toEqual({ format: '-x' });
  });

  it.each([
    [['--formt', 'json'], 'Unknown option --formt for check. Did you mean "--format"?'],
    [['-x'], 'Unknown option -x for check.'],
    [['--zzzzzz'], 'Unknown option --zzzzzz for check.'],
    [['--format'], 'Option --format needs a value.'],
    [['--format', '--quiet'], 'Option --format needs a value.'],
    [['--quiet=1'], 'Option --quiet does not take a value.'],
    [['--format', 'a', '--format', 'b'], 'Option --format was given more than once.'],
  ])('rejects %j', (args, message) => {
    expect(() => parseCommandArgs(args, SPECS, 'check')).toThrow(message);
    try {
      parseCommandArgs(args, SPECS, 'check');
    } catch (error) {
      expect((error as { exitCode: number }).exitCode).toBe(ExitCode.Usage);
    }
  });
});

describe('colour', () => {
  it('is on only for a terminal without NO_COLOR or --no-color', () => {
    expect(colorEnabled({ isTTY: true, env: {}, noColor: false })).toBe(true);
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '' }, noColor: false })).toBe(true);
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: '1' }, noColor: false })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: {}, noColor: true })).toBe(false);
    expect(colorEnabled({ isTTY: false, env: {}, noColor: false })).toBe(false);
  });

  it('wraps text in ANSI codes only when enabled', () => {
    const on = colors(true);
    expect(on.red('x')).toBe('\u001b[31mx\u001b[39m');
    expect(on.yellow('x')).toBe('\u001b[33mx\u001b[39m');
    expect(on.cyan('x')).toBe('\u001b[36mx\u001b[39m');
    expect(on.dim('x')).toBe('\u001b[2mx\u001b[22m');
    expect(on.bold('x')).toBe('\u001b[1mx\u001b[22m');
    const off = colors(false);
    expect([off.red('x'), off.yellow('x'), off.cyan('x'), off.dim('x'), off.bold('x')]).toEqual([
      'x',
      'x',
      'x',
      'x',
      'x',
    ]);
  });
});

function finding(ruleId: Finding['ruleId'], severity: Finding['severity']): Finding {
  return { ruleId, severity, message: 'm', file: 'f.sql', line: 1, column: 1, docsUrl: 'u' };
}

describe('exitCodeFor', () => {
  const policy = { strictParse: false };
  it('is 0 without errors and within --max-warnings', () => {
    expect(exitCodeFor({ findings: [] }, policy)).toBe(0);
    expect(exitCodeFor({ findings: [finding('GL005', 'warn')] }, policy)).toBe(0);
    expect(
      exitCodeFor({ findings: [finding('GL005', 'warn')] }, { ...policy, maxWarnings: 1 }),
    ).toBe(0);
    expect(exitCodeFor({ findings: [finding('PARSE001', 'info')] }, { strictParse: true })).toBe(0);
  });

  it('is 1 for an error, or more warnings than --max-warnings', () => {
    expect(exitCodeFor({ findings: [finding('GL001', 'error')] }, policy)).toBe(1);
    expect(
      exitCodeFor({ findings: [finding('GL005', 'warn')] }, { ...policy, maxWarnings: 0 }),
    ).toBe(1);
    // PARSE001 set to error in config, without --strict-parse, is an ordinary error.
    expect(exitCodeFor({ findings: [finding('PARSE001', 'error')] }, policy)).toBe(1);
  });

  it('is 3 for a PARSE001 error under --strict-parse, before any other finding', () => {
    expect(
      exitCodeFor(
        { findings: [finding('GL001', 'error'), finding('PARSE001', 'error')] },
        { strictParse: true },
      ),
    ).toBe(3);
  });
});

describe('redact', () => {
  it('hides credentials in database URLs', () => {
    expect(redact('cannot reach postgresql://admin:s3cret@db.example.com:5432/app')).toBe(
      'cannot reach postgresql://***@db.example.com:5432/app',
    );
    expect(redact('POSTGRES://u:p@h/x and postgres://h/x')).toBe(
      'POSTGRES://***@h/x and postgres://h/x',
    );
  });
});

describe('run', () => {
  it('prints usage for no command and for global --help', async () => {
    for (const argv of [[], ['help'], ['--help']]) {
      const { io, stdout } = fakeIo();
      expect(await run(argv, io)).toBe(ExitCode.Ok);
      expect(stdout()).toMatch(/^Usage: supabase-grants-lint <command>/);
    }
  });

  it('asks for options after the command', async () => {
    const { io, stderr } = fakeIo();
    expect(await run(['--help', 'check'], io)).toBe(ExitCode.Usage);
    expect(stderr()).toContain(
      'Put options after the command, e.g. supabase-grants-lint check --help.',
    );
  });

  it('reports commands that are not built yet as usage errors', async () => {
    const { io, stderr } = fakeIo();
    expect(await run(['doctor'], io)).toBe(ExitCode.Usage);
    expect(stderr()).toContain('doctor is not available in this build yet.');
  });

  it.each([
    ['json', /^\{\n {2}"schemaVersion": 1,/],
    ['sarif', /^\{\n {2}"\$schema": "https:\/\/json\.schemastore\.org\/sarif-2\.1\.0\.json",/],
    [
      'github',
      /^::error file=test\/e2e\/projects\/errors\/supabase\/migrations\/\d+_add_todos\.sql,line=1,col=1,title=GL001::/,
    ],
  ])('prints --format %s without colour, even on a terminal', async (format, start) => {
    const { io, stdout } = fakeIo({ isTTY: true });
    const args = ['check', '--dir', path.join(PROJECTS, 'errors'), '--format', format];
    expect(await run(args, io)).toBe(ExitCode.Findings);
    expect(stdout()).toMatch(start);
    expect(stdout()).not.toContain('\u001b[');
  });

  it('turns an unexpected exception into exit 3 with a bug report request, redacted', async () => {
    const { io, stderr } = fakeIo({
      stdout: () => {
        throw new Error('write failed for postgres://u:pw@host/db');
      },
    });
    expect(await run(['--version'], io)).toBe(ExitCode.Internal);
    expect(stderr()).toMatch(/^Internal error: write failed for postgres:\/\/\*\*\*@host\/db\n/);
    expect(stderr()).toContain('This is a bug in supabase-grants-lint');
    expect(stderr()).not.toContain('pw');
  });

  it('reports a non-Error throw as an internal error', async () => {
    const { io, stderr } = fakeIo({
      stdout: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'boom';
      },
    });
    expect(await run(['--version'], io)).toBe(ExitCode.Internal);
    expect(stderr()).toMatch(/^Internal error: boom\n/);
  });

  it('checks with --schema, --since and --config, and colours output on a terminal', async () => {
    const { io, stdout } = fakeIo({ isTTY: true });
    const code = await run(
      [
        'check',
        '--dir',
        path.join(PROJECTS, 'errors'),
        '--schema',
        'public',
        '--since',
        '20261001000000',
      ],
      io,
    );
    expect(code).toBe(ExitCode.Findings);
    expect(stdout()).toContain('\u001b[31merror\u001b[39m');
    expect(stdout()).toContain('\u001b[31m1 error, 0 warnings');
  });

  it('colours a warnings-only summary yellow', async () => {
    const { io, stdout } = fakeIo({ isTTY: true });
    expect(await run(['check', '--dir', path.join(PROJECTS, 'warnings')], io)).toBe(ExitCode.Ok);
    expect(stdout()).toContain('\u001b[33m0 errors, 1 warning');
  });
});

describe('lint', () => {
  it('resolves since from the flag and counts files, relations and findings', async () => {
    const result = await lint({ cwd: ROOT, dir: 'test/e2e/projects/errors', since: 'none' });
    expect(result.since).toEqual({ value: 'none', source: 'cli', detected: null });
    expect(result.summary).toMatchObject({ files: 2, relations: 1, errors: 1, warnings: 0 });
    expect(result.findings.map((f) => f.ruleId)).toEqual(['GL001']);
  });

  it('reads an explicit config file and schema list', async () => {
    const result = await lint({
      cwd: path.join(PROJECTS, 'errors'),
      configFile: '../bad-config/grants-lint.config.json',
    }).catch((error: unknown) => error);
    expect(String(result)).toContain('"platformDefault" is not a known key');
    const other = await lint({ cwd: path.join(PROJECTS, 'errors'), schemas: ['api'] });
    expect(other.summary).toMatchObject({ relations: 0, errors: 0 });
  });

  it('counts notices and info findings together', async () => {
    const result = await lint({ cwd: path.join(PROJECTS, 'unparseable') });
    expect(result.summary.notices).toBe(1);
  });
});

describe('formatText', () => {
  it('prints notices with their location unless --quiet', async () => {
    // Enforcing from the first file assumes the platform revoke before it: one located notice.
    const result = await lint({ cwd: path.join(PROJECTS, 'clean'), since: '0' });
    const text = formatText(result, colors(false), false);
    expect(text).toMatch(
      /^notice {2}supabase\/migrations\/20261001000000_opt_in\.sql:1: Assumed the platform revoke/,
    );
    expect(formatText(result, colors(false), true)).not.toContain('notice');
    const bare = formatText(
      { ...result, findings: [], notices: [{ code: 'unused-ignore', message: 'Unused.' }] },
      colors(false),
      false,
    );
    expect(bare).toMatch(/^notice {2}Unused\.\n\n0 errors/);
    const fileOnly = formatText(
      {
        ...result,
        findings: [],
        notices: [{ code: 'unused-ignore', message: 'U.', file: 'a.sql' }],
      },
      colors(false),
      false,
    );
    expect(fileOnly).toContain('notice  a.sql: U.');
  });

  it('groups findings by file and colours info cyan', async () => {
    const result = await lint({ cwd: path.join(PROJECTS, 'unparseable') });
    const two = {
      ...result,
      findings: [...result.findings, { ...finding('GL005', 'warn'), file: 'z.sql' }],
    };
    const text = formatText(two, colors(true), false);
    expect(text).toContain('\u001b[36minfo\u001b[39m');
    expect(text).toContain('\u001b[33mwarn\u001b[39m');
    expect(text).toContain('\n\n\u001b[1mz.sql\u001b[22m\n');
  });
});
