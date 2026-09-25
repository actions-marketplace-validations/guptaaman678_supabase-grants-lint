import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL007 } from '../../src/rules/GL007.js';
import { docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;`;

const BASELINE = `alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;`;

const file = (i: number) => `supabase/migrations/2026100${String(i + 1)}000000_m.sql`;

/** Lints the sources as consecutive migrations, with GL007 only. */
function lint(sources: readonly string[], config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const inputs = sources.map((source, i) => ({
    file: file(i),
    version: `2026100${String(i + 1)}000000`,
    statements: parser.parse(source, file(i)).statements,
  }));
  return runRules({ config: full, replay: replayWithWindow(inputs, full), rules: [GL007] })
    .findings;
}

const at = (findings: readonly Finding[]) =>
  findings.map((f) => `${f.file.slice(-20)}:${String(f.line)} ${f.severity}`);

describe('GL007 replay-reenables-defaults', () => {
  it('states the consequence and the fix, anchored at the last statement that granted', () => {
    const findings = lint([BASELINE, 'create table public.todos (id uuid primary key);']);
    expect(findings).toEqual([
      {
        ruleId: 'GL007',
        severity: 'warn',
        message:
          'Replaying these migrations (supabase db reset, a preview branch) leaves default ' +
          'privileges that give anon, authenticated, service_role all privileges on new tables ' +
          'and all privileges on new sequences postgres creates in schema public, so new ' +
          'relations get grants there that production, with automatic grants off, does not ' +
          'give them. Revoke them in a new migration.',
        file: file(0),
        line: 3,
        column: 1,
        fix: [
          'alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;',
          'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;',
        ].join('\n'),
        docsUrl: docsUrl('GL007'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('counts statements in the files only, not the initial state', () => {
    expect(lint(['create table public.todos (id uuid primary key);'])).toEqual([]);
    expect(lint([BASELINE], { platformDefaults: 'explicit' })).toHaveLength(1);
    expect(lint([BASELINE, OPT_IN])).toEqual([]);
    expect(lint([BASELINE, OPT_IN], { platformDefaults: 'explicit' })).toEqual([]);
  });

  it('ignores the platform revoke assumed at since, which a replay does not run', () => {
    const findings = lint([BASELINE, 'create table public.todos (id uuid primary key);'], {
      since: '20261001000000',
    });
    expect(at(findings)).toEqual(['20261001000000_m.sql:3 warn']);
    expect(findings[0]?.message).toContain('all privileges on new tables and all privileges');
  });

  it('is an error when since was auto-detected and a later file re-grants', () => {
    const regrant = 'alter default privileges in schema public grant select on tables to anon;';
    expect(at(lint([OPT_IN, regrant]))).toEqual(['20261002000000_m.sql:1 error']);
    expect(at(lint([OPT_IN, regrant], { since: '20261001000000' }))).toEqual([
      '20261002000000_m.sql:1 warn',
    ]);
    expect(at(lint([`${OPT_IN}\n${regrant}`]))).toEqual(['20261001000000_m.sql:5 warn']);
    expect(at(lint([regrant]))).toEqual(['20261001000000_m.sql:1 warn']);
    expect(at(lint([regrant, OPT_IN, 'select 1;'], { since: 'none' }))).toEqual([]);
  });

  it('anchors at the last grant still in effect, not at one a later revoke undid', () => {
    const findings = lint([
      'alter default privileges in schema public grant select on tables to anon;',
      'alter default privileges in schema public grant insert on tables to anon;',
      [
        'alter default privileges in schema public grant update on tables to anon, reporting;',
        'alter default privileges in schema public revoke insert, update on tables from anon;',
        'alter default privileges in schema public grant select on tables to reporting;',
      ].join('\n'),
    ]);
    expect(at(findings)).toEqual(['20261001000000_m.sql:1 warn']);
    expect(findings[0]?.message).toContain('give anon select on new tables postgres');
  });

  it('does not anchor at a later grant for another creator or an unscoped schema', () => {
    const grant = 'alter default privileges in schema public grant select on tables to anon;';
    expect(
      at(
        lint([
          grant,
          'alter default privileges for role supabase_admin in schema public grant select on tables to anon;',
        ]),
      ),
    ).toEqual(['20261001000000_m.sql:1 warn']);
    expect(
      at(
        lint([grant, 'alter default privileges in schema private grant select on tables to anon;']),
      ),
    ).toEqual(['20261001000000_m.sql:1 warn']);
  });

  it('keeps privileges a grant-option revoke leaves, and lists what is still held', () => {
    const findings = lint([
      'alter default privileges grant usage, select on sequences to authenticated with grant option;',
      'alter default privileges revoke grant option for usage on sequences from authenticated;',
    ]);
    expect(at(findings)).toEqual(['20261001000000_m.sql:1 warn']);
    expect(findings[0]?.message).toContain(
      'give authenticated usage, select on new sequences postgres creates in any schema,',
    );
    expect(findings[0]?.fix).toBe(
      'alter default privileges for role postgres revoke all on sequences from authenticated;',
    );
  });

  it('finds a grant for all schemas that a per-schema revoke cannot remove', () => {
    const findings = lint(['alter default privileges grant all on tables to anon;', OPT_IN]);
    expect(at(findings)).toEqual(['20261001000000_m.sql:1 warn']);
    expect(findings[0]?.fix).toBe(
      'alter default privileges for role postgres revoke all on tables from anon;',
    );
  });

  it('flags client roles, PUBLIC and the service role, and names only those', () => {
    const [finding] = lint([
      'alter default privileges in schema public grant select on tables to reporting, public, service_role, anon;',
    ]);
    expect(finding?.message).toContain('give anon, service_role, PUBLIC select on new tables');
    expect(finding?.fix).toBe(
      'alter default privileges for role postgres in schema public revoke all on tables from anon, service_role, public;',
    );
    expect(lint(['alter default privileges grant select on tables to reporting;'])).toEqual([]);
    expect(
      lint(['alter default privileges grant select on tables to backend;'], {
        serviceRole: 'backend',
      }),
    ).toHaveLength(1);
    expect(
      lint(['alter default privileges grant select on tables to staff;'], {
        clientRoles: ['staff'],
      }),
    ).toHaveLength(1);
  });

  it('checks the migration role only, and scoped schemas or all schemas', () => {
    expect(
      lint(['alter default privileges for role supabase_admin grant all on tables to anon;']),
    ).toEqual([]);
    expect(
      lint(['alter default privileges in schema private grant all on tables to anon;']),
    ).toEqual([]);
    const api = lint(
      [
        [
          'alter default privileges in schema api, private grant select on tables to anon;',
          'alter default privileges in schema public grant usage on sequences to anon;',
        ].join('\n'),
      ],
      { schemas: ['public', 'api', 'public'] },
    );
    expect(at(api)).toEqual(['20261001000000_m.sql:2 warn']);
    expect(api[0]?.message).toContain(
      'give anon select on new tables and usage on new sequences postgres creates in schema api, public,',
    );
    expect(api[0]?.fix).toBe(
      [
        'alter default privileges for role postgres in schema api revoke all on tables from anon;',
        'alter default privileges for role postgres in schema public revoke all on sequences from anon;',
      ].join('\n'),
    );
    const owner = lint(['alter default privileges grant select on tables to anon;'], {
      migrationRole: 'App Owner',
    });
    expect(owner[0]?.message).toContain('new tables App Owner creates');
    expect(owner[0]?.fix).toBe(
      'alter default privileges for role "App Owner" revoke all on tables from anon;',
    );
  });

  it('follows the creator of each statement, as the replay resolves it', () => {
    expect(
      lint(['set role app_owner;\nalter default privileges grant select on tables to anon;']),
    ).toEqual([]);
    expect(
      lint(['set role app_owner;\nalter default privileges grant select on tables to anon;'], {
        migrationRole: 'app_owner',
      }),
    ).toHaveLength(1);
  });

  it('does not count a grant of privileges invalid for the object kind', () => {
    expect(lint(['alter default privileges grant usage on tables to anon;'])).toEqual([]);
  });

  it('reports once per run, with no relation or role', () => {
    const findings = lint([BASELINE, BASELINE]);
    expect(
      findings.map((f) => `${f.file.slice(-20)} ${f.role ?? '-'} ${f.relation ?? '-'}`),
    ).toEqual(['20261002000000_m.sql - -']);
  });
});

describe('GL007 in the rule list', () => {
  it('is registered after GL006', () => {
    expect(RULES.map((r) => r.id).slice(0, 7)).toEqual([
      'GL001',
      'GL002',
      'GL003',
      'GL004',
      'GL005',
      'GL006',
      'GL007',
    ]);
    expect(GL007).toMatchObject({ name: 'replay-reenables-defaults', defaultSeverity: 'warn' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL007 +replay-reenables-defaults +warn$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL007')).toEqual({
      id: 'GL007',
      name: 'replay-reenables-defaults',
      shortDescription: { text: GL007.docs },
      helpUri: docsUrl('GL007'),
      defaultConfiguration: { level: 'warning' },
    });
  });
});
