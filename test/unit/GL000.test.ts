import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL000 } from '../../src/rules/GL000.js';
import { docsUrl, type Finding, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;`;

const TODOS = 'create table public.todos (id uuid primary key);';

const file = (i: number) => `supabase/migrations/2026100${String(i + 1)}000000_m.sql`;

/** Lints the sources as consecutive migrations, with GL000 only. */
function lint(sources: readonly string[], config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const inputs = sources.map((source, i) => ({
    file: file(i),
    version: `2026100${String(i + 1)}000000`,
    statements: parser.parse(source, file(i)).statements,
  }));
  return runRules({ config: full, replay: replayWithWindow(inputs, full), rules: [GL000] })
    .findings;
}

describe('GL000 no-enforcement-baseline', () => {
  it('reports once, on the first line of the last file, without claiming the project is not opted in', () => {
    const findings = lint([TODOS, TODOS.replace('todos', 'orders')]);
    expect(findings).toEqual([
      {
        ruleId: 'GL000',
        severity: 'warn',
        message:
          'No opt-in migration found, so the rules that check new relations (GL001 to GL006, ' +
          'GL008) checked no file. If your project was opted in from the dashboard, or you are ' +
          'past 2026-10-30, set since to the last migration applied before that ' +
          '(supabase-grants-lint init --since next). Otherwise add the opt-in migration that ' +
          'supabase-grants-lint doctor prints.',
        file: file(1),
        line: 1,
        column: 1,
        docsUrl: docsUrl('GL000'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
    expect(findings[0]?.message).not.toMatch(/not opted in/i); // ADR-002 item 2
  });

  it('is silent whenever since resolves', () => {
    expect(lint([OPT_IN, TODOS])).toEqual([]);
    expect(lint([TODOS], { since: 'none' })).toEqual([]);
    expect(lint([TODOS, TODOS.replace('todos', 'orders')], { since: '20261001000000' })).toEqual(
      [],
    );
  });

  it('reports nothing when there are no migrations', () => {
    expect(lint([])).toEqual([]);
  });

  it('can be set to error in config', () => {
    expect(lint([TODOS], { rules: { GL000: 'error' } }).map((f) => f.severity)).toEqual(['error']);
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL000 +no-enforcement-baseline +warn$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL000')).toEqual({
      id: 'GL000',
      name: 'no-enforcement-baseline',
      shortDescription: { text: GL000.docs },
      helpUri: docsUrl('GL000'),
      defaultConfiguration: { level: 'warning' },
    });
  });
});
