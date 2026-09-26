import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL006 } from '../../src/rules/GL006.js';
import { docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;`;

function inputs(sources: readonly string[]) {
  return sources.map((source, i) => {
    const version = `2026100${String(i + 1)}000000`;
    const file = `supabase/migrations/${version}_m.sql`;
    return { file, version, statements: parser.parse(source, file).statements };
  });
}

/** Lints each source after an opt-in (the later ones enforced), with GL006 only. */
function lint(sql: string | readonly string[], config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const files = inputs([OPT_IN, ...(typeof sql === 'string' ? [sql] : sql)]);
  return runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL006] }).findings;
}

const lines = (findings: readonly Finding[]) => findings.map((f) => f.line);

describe('GL006 default-privileges-regrant', () => {
  it('states the consequence and the fix, anchored at the statement, with no fix SQL', () => {
    const findings = lint(
      [
        'create table public.todos (id uuid primary key);',
        '',
        '  alter default privileges in schema public',
        '    grant select, insert on tables to anon, authenticated;',
      ].join('\n'),
    );
    expect(findings).toEqual([
      {
        ruleId: 'GL006',
        severity: 'error',
        message:
          'This default privilege gives anon, authenticated select, insert on every table ' +
          'postgres creates in schema public from here on, turning automatic Data API grants ' +
          'back on after the opt-in. Remove it and grant on each new table by name.',
        file: 'supabase/migrations/20261002000000_m.sql',
        line: 3,
        column: 3,
        docsUrl: docsUrl('GL006'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('flags sequences, says all privileges for ALL, and any schema without IN SCHEMA', () => {
    const [sequence] = lint(
      'alter default privileges for role postgres grant all on sequences to service_role;',
    );
    expect(sequence?.message).toBe(
      'This default privilege gives service_role all privileges on every sequence postgres ' +
        'creates in any schema from here on, turning automatic Data API grants back on after the ' +
        'opt-in. Remove it and grant on each new sequence by name.',
    );
    const [tables] = lint('alter default privileges grant all privileges on tables to anon;');
    expect(tables?.message).toContain('gives anon all privileges on every table postgres');
    const [some] = lint('alter default privileges grant usage, select on sequences to anon;');
    expect(some?.message).toContain('gives anon usage, select on every sequence');
  });

  it('flags client roles, PUBLIC and the service role, and names only those', () => {
    const [finding] = lint(
      'alter default privileges in schema public grant select on tables to staff, public, anon;',
    );
    expect(finding?.message).toContain('gives PUBLIC, anon select on');
    const all = lint(
      [
        'alter default privileges grant select on tables to authenticated;',
        'alter default privileges grant select on tables to service_role;',
        'alter default privileges grant select on tables to staff, postgres;',
      ].join('\n'),
    );
    expect(lines(all)).toEqual([1, 2]);
    expect(
      lint('alter default privileges grant all on tables to backend;', { serviceRole: 'backend' }),
    ).toHaveLength(1);
    expect(
      lint('alter default privileges grant select on tables to staff;', { clientRoles: ['staff'] }),
    ).toHaveLength(1);
  });

  it('flags grants only, not revokes', () => {
    expect(lint('alter default privileges revoke all on tables from anon;')).toEqual([]);
    expect(
      lint('alter default privileges revoke grant option for select on tables from anon;'),
    ).toEqual([]);
    expect(
      lint('alter default privileges grant select on tables to anon with grant option;'),
    ).toHaveLength(1);
  });

  it('checks scoped schemas or all schemas, and names only the scoped ones', () => {
    expect(
      lint('alter default privileges in schema private grant select on tables to anon;'),
    ).toEqual([]);
    const [finding] = lint(
      'alter default privileges in schema private, public grant select on tables to anon;',
    );
    expect(finding?.message).toContain('creates in schema public from');
    const api = lint(
      'alter default privileges in schema api, public grant select on tables to anon;',
      { schemas: ['public', 'api'] },
    );
    expect(api[0]?.message).toContain('creates in schema api, public from');
  });

  it('checks the creator role: migrationRole, or the role SET ROLE made current', () => {
    expect(
      lint('alter default privileges for role supabase_admin grant select on tables to anon;'),
    ).toEqual([]);
    const [both] = lint(
      'alter default privileges for role supabase_admin, postgres grant select on tables to anon;',
    );
    expect(both?.message).toContain('every table postgres creates');
    const current = lint(
      [
        'set role app_owner;',
        'alter default privileges grant select on tables to anon;',
        'alter default privileges for role postgres grant select on tables to anon;',
        'reset role;',
        'alter default privileges for role app_owner grant select on tables to anon;',
      ].join('\n'),
    );
    expect(current.map((f) => `${String(f.line)} ${f.message.split(' creates')[0] ?? ''}`)).toEqual(
      [
        '2 This default privilege gives anon select on every table app_owner',
        '3 This default privilege gives anon select on every table postgres',
      ],
    );
    const owner = lint('alter default privileges grant select on tables to anon;', {
      migrationRole: 'app_owner',
      since: '20261001000000', // the opt-in above is for postgres, so not detected
    });
    expect(owner[0]?.message).toContain('every table app_owner creates');
  });

  it('does not flag a grant of privileges invalid for the object kind', () => {
    expect(lint('alter default privileges grant usage on tables to anon;')).toEqual([]);
  });

  it('checks only enforced files', () => {
    const full = { ...DEFAULT_CONFIG, platformDefaults: 'explicit' as const };
    const files = inputs(['alter default privileges grant select on tables to anon;', OPT_IN]);
    expect(
      runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL006] }).findings,
    ).toEqual([]);
    const none = { ...full, since: 'none' };
    expect(
      runRules({ config: none, replay: replayWithWindow(files, none), rules: [GL006] }).findings,
    ).toHaveLength(1);
  });

  it('reports each statement once, with no relation or role', () => {
    const findings = lint(
      [
        'alter default privileges in schema public grant select on tables to anon, authenticated;',
        'alter default privileges in schema public grant usage on sequences to anon, authenticated;',
      ].join('\n'),
    );
    expect(findings.map((f) => `${String(f.line)} ${f.role ?? '-'} ${f.relation ?? '-'}`)).toEqual([
      '1 - -',
      '2 - -',
    ]);
  });
});

describe('GL006 in the rule list', () => {
  it('is registered after GL005', () => {
    expect(RULES.map((r) => r.id).slice(1, 7)).toEqual([
      'GL001',
      'GL002',
      'GL003',
      'GL004',
      'GL005',
      'GL006',
    ]);
    expect(GL006).toMatchObject({ name: 'default-privileges-regrant', defaultSeverity: 'error' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL006 +default-privileges-regrant +error$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL006')).toEqual({
      id: 'GL006',
      name: 'default-privileges-regrant',
      shortDescription: { text: GL006.docs },
      helpUri: docsUrl('GL006'),
      defaultConfiguration: { level: 'error' },
    });
  });
});
