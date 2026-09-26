import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifLevel, sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL001 } from '../../src/rules/GL001.js';
import { docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;`;

/** Lints `sql` as the migration after an opt-in, with GL001 only. */
function lint(sql: string, config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const sources = [OPT_IN, sql];
  const files = sources.map((source, i) => {
    const version = `2026100${String(i + 1)}000000`;
    const file = `supabase/migrations/${version}_m.sql`;
    return { file, version, statements: parser.parse(source, file).statements };
  });
  return runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL001] }).findings;
}

describe('GL001 missing-service-role-grant', () => {
  it('states the consequence and the fix, anchored at the CREATE statement', () => {
    const findings = lint('select 1;\n\n  create table public.todos (id int);');
    expect(findings).toEqual([
      {
        ruleId: 'GL001',
        severity: 'error',
        message:
          'public.todos is created without a grant to service_role: server-side requests as ' +
          'service_role (edge functions, admin tools) fail with 42501 permission denied, because ' +
          'service_role bypasses RLS but not grants. Grant it the privileges it needs in the same ' +
          'migration.',
        file: 'supabase/migrations/20261002000000_m.sql',
        line: 3,
        column: 3,
        relation: 'public.todos',
        role: 'service_role',
        fix: 'grant select, insert, update, delete on public.todos to service_role;',
        docsUrl: docsUrl('GL001'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('fixes tables and foreign tables with DML, views and materialized views with select', () => {
    const fixes = lint(
      [
        'create table public.orders (id int);',
        'create foreign table public.remote_orders (id int) server remote;',
        'create view public.order_summary as select 1 as n;',
        'create materialized view public.order_totals as select 1 as n;',
      ].join('\n'),
    ).map((f) => f.fix);
    expect(fixes).toEqual([
      'grant select, insert, update, delete on public.orders to service_role;',
      'grant select, insert, update, delete on public.remote_orders to service_role;',
      'grant select on public.order_summary to service_role;',
      'grant select on public.order_totals to service_role;',
    ]);
  });

  it('quotes identifiers in the fix only when Postgres needs it', () => {
    const [finding] = lint('create table public."Order Items" (id int);', {
      serviceRole: 'Admin',
    });
    expect(finding?.relation).toBe('public.Order Items');
    expect(finding?.role).toBe('Admin');
    expect(finding?.fix).toBe(
      'grant select, insert, update, delete on public."Order Items" to "Admin";',
    );
  });

  it('is satisfied by any DML privilege, not by truncate, references, trigger or maintain', () => {
    const grant = (privilege: string) =>
      lint(
        `create table public.todos (id int);\ngrant ${privilege} on public.todos to service_role;`,
      );
    for (const privilege of ['select', 'insert', 'update', 'delete']) {
      expect(grant(privilege), privilege).toEqual([]);
    }
    for (const privilege of ['truncate', 'references', 'trigger', 'maintain']) {
      expect(
        grant(privilege).map((f) => f.relation),
        privilege,
      ).toEqual(['public.todos']);
    }
    expect(grant('truncate, references, trigger, maintain').map((f) => f.relation)).toEqual([
      'public.todos',
    ]);
  });

  it('counts DML held through PUBLIC', () => {
    expect(
      lint('create table public.todos (id int);\ngrant select on public.todos to public;'),
    ).toEqual([]);
  });

  it('reads the service role from config', () => {
    const sql = 'create table public.todos (id int);\ngrant all on public.todos to service_role;';
    expect(lint(sql)).toEqual([]);
    expect(lint(sql, { serviceRole: 'api_admin' }).map((f) => f.role)).toEqual(['api_admin']);
  });

  it('checks only enforced files', () => {
    const full = { ...DEFAULT_CONFIG, platformDefaults: 'explicit' as const };
    const files = ['create table public.todos (id int);', OPT_IN].map((source, i) => {
      const version = `2026100${String(i + 1)}000000`;
      const file = `supabase/migrations/${version}_m.sql`;
      return { file, version, statements: parser.parse(source, file).statements };
    });
    const replay = replayWithWindow(files, full);
    expect(runRules({ config: full, replay, rules: [GL001] }).findings).toEqual([]);
    const all = replayWithWindow(files, { ...full, since: 'none' });
    expect(
      runRules({ config: { ...full, since: 'none' }, replay: all, rules: [GL001] }).findings.map(
        (f) => f.relation,
      ),
    ).toEqual(['public.todos']);
  });
});

describe('GL001 in the rule list', () => {
  it('is registered', () => {
    expect(RULES.map((r) => r.id)).toContain('GL001');
    expect(GL001).toMatchObject({ name: 'missing-service-role-grant', defaultSeverity: 'error' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^Rules:$/m);
    expect(usage()).toMatch(/^ {2}GL001 +missing-service-role-grant +error$/m);
    expect(usage([])).not.toContain('Rules:');
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL001')).toEqual({
      id: 'GL001',
      name: 'missing-service-role-grant',
      shortDescription: { text: GL001.docs },
      helpUri: docsUrl('GL001'),
      defaultConfiguration: { level: 'error' },
    });
    expect(sarifRules().map((d) => d.id)).toEqual(RULES.map((r) => r.id));
  });

  it('maps severities to SARIF levels', () => {
    expect([sarifLevel('error'), sarifLevel('warn'), sarifLevel('info')]).toEqual([
      'error',
      'warning',
      'note',
    ]);
  });
});
