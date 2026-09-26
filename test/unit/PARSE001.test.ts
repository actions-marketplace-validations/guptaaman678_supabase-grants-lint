import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { DiscoveryNotice } from '../../src/load/discover.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { docsUrl, type Finding, type RunRulesOptions, runRules } from '../../src/rules/index.js';
import { PARSE001 } from '../../src/rules/PARSE001.js';
import { PARSE002 } from '../../src/rules/PARSE002.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const TODOS = 'create table public.todos (id uuid primary key);';
const TYPO = 'create tabel public.orders (id uuid primary key);';
const DO_GRANT = "do $$ begin execute 'grant select on public.todos to anon'; end $$;";

const file = (i: number) => `supabase/migrations/2026100${String(i + 1)}000000_m.sql`;

type Extra = Partial<Pick<RunRulesOptions, 'discovery' | 'strictParse' | 'rules'>>;

/** Lints the sources as consecutive migrations (an entry `[name, sql]` is unversioned). */
function lint(
  sources: readonly (string | readonly [string, string])[],
  config: Partial<Config> = {},
  extra: Extra = {},
): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const inputs = sources.map((source, i) => {
    const [name, sql] = typeof source === 'string' ? [file(i), source] : source;
    return {
      file: name,
      version: typeof source === 'string' ? `2026100${String(i + 1)}000000` : null,
      statements: parser.parse(sql, name).statements,
    };
  });
  return runRules({
    config: full,
    replay: replayWithWindow(inputs, full),
    rules: [PARSE001],
    ...extra,
  }).findings;
}

describe('PARSE001 unparseable-statement', () => {
  it('reports a statement the parser rejected, with the parser message, as info', () => {
    const findings = lint([`${TODOS}\n${TYPO}`]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'PARSE001',
      severity: 'info',
      file: file(0),
      line: 2,
      column: 1,
      docsUrl: docsUrl('PARSE001'),
    });
    expect(findings[0]?.message).toMatch(
      /^The replay skipped this statement because it could not be parsed \(syntax error at or near "tabel".*\), so any grant, table or policy in it is not checked\. If Postgres accepts it, please report it as a bug\.$/,
    );
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
    expect(findings[0]).not.toHaveProperty('fix');
  });

  it('reports a file without a version prefix, on its first line', () => {
    const discovery: DiscoveryNotice[] = [
      {
        ruleId: 'PARSE001',
        file: 'supabase/migrations/seed.sql',
        message: 'seed.sql has no prefix',
      },
    ];
    const findings = lint([TODOS, ['supabase/migrations/seed.sql', TODOS]], {}, { discovery });
    expect(findings).toEqual([
      {
        ruleId: 'PARSE001',
        severity: 'info',
        message:
          'seed.sql has no prefix. The rules that check new relations (GL001 to GL006, GL008) ' +
          'check it only when since is "none".',
        file: 'supabase/migrations/seed.sql',
        line: 1,
        column: 1,
        docsUrl: docsUrl('PARSE001'),
      },
    ]);
  });

  it('checks every file, enforced or not, and ignores other skipped statements', () => {
    const optIn = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;`;
    expect(lint([TYPO, optIn, `${DO_GRANT}\n${TODOS}`]).map((f) => f.file)).toEqual([file(0)]);
  });

  it('runs as an error under --strict-parse, whatever config says, and changes no other rule', () => {
    const sources = [`${TYPO}\n${DO_GRANT}`];
    const both = { rules: [PARSE001, PARSE002] };
    const severities = (config: Partial<Config>, strictParse: boolean) =>
      lint(sources, config, { ...both, strictParse }).map((f) => `${f.ruleId} ${f.severity}`);
    expect(severities({}, false)).toEqual(['PARSE001 info', 'PARSE002 info']);
    expect(severities({}, true)).toEqual(['PARSE001 error', 'PARSE002 info']);
    expect(severities({ rules: { PARSE001: 'off' } }, true)).toEqual([
      'PARSE001 error',
      'PARSE002 info',
    ]);
    expect(severities({ rules: { PARSE001: 'off' } }, false)).toEqual(['PARSE002 info']);
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}PARSE001 +unparseable-statement +info$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'PARSE001')).toEqual({
      id: 'PARSE001',
      name: 'unparseable-statement',
      shortDescription: { text: PARSE001.docs },
      helpUri: docsUrl('PARSE001'),
      defaultConfiguration: { level: 'note' },
    });
  });
});
