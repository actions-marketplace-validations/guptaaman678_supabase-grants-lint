import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL005 } from '../../src/rules/GL005.js';
import { docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;`;

const BASE = `create table public.todos (id uuid primary key);
create table public.audit_log (id bigserial primary key);
revoke all on public.audit_log from anon, authenticated;`;

function inputs(sources: readonly string[]) {
  return sources.map((source, i) => {
    const version = `2026100${String(i + 1)}000000`;
    const file = `supabase/migrations/${version}_m.sql`;
    return { file, version, statements: parser.parse(source, file).statements };
  });
}

/** Lints each source after a base file and an opt-in (the last ones enforced), with GL005 only. */
function lint(sql: string | readonly string[], config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const files = inputs([BASE, OPT_IN, ...(typeof sql === 'string' ? [sql] : sql)]);
  return runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL005] }).findings;
}

const lines = (findings: readonly Finding[]) =>
  findings.map((f) => `${String(f.line)} ${f.fix ?? '-'}`);

describe('GL005 blanket-grant', () => {
  it('states the consequence and the fix, anchored at the GRANT statement', () => {
    const findings = lint(
      [
        'create table public.orders (id uuid primary key);',
        '',
        '  grant select, insert on all tables in schema public to authenticated;',
      ].join('\n'),
    );
    expect(findings).toEqual([
      {
        ruleId: 'GL005',
        severity: 'warn',
        message:
          'This grant on all tables in schema public to authenticated applies to every relation ' +
          'that exists there at this point (3 relations), including any deliberately narrowed ' +
          'earlier, and to none created later. Grant on the relations by name instead.',
        file: 'supabase/migrations/20261003000000_m.sql',
        line: 3,
        column: 3,
        fix: 'grant select, insert on public.orders to authenticated;',
        docsUrl: docsUrl('GL005'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('flags ALL SEQUENCES IN SCHEMA too (ADR-004 item 1)', () => {
    const [finding] = lint(
      'create table public.orders (id serial);\ngrant usage on all sequences in schema public to anon;',
    );
    expect(finding?.message).toBe(
      'This grant on all sequences in schema public to anon applies to every sequence that ' +
        'exists there at this point (2 sequences), including any deliberately narrowed earlier, ' +
        'and to none created later. Grant on the sequences by name instead.',
    );
    expect(finding?.fix).toBe('grant usage on sequence public.orders_id_seq to anon;');
  });

  it('flags client roles, PUBLIC and the service role, and names only those', () => {
    const [finding] = lint('grant select on all tables in schema public to staff, public, anon;');
    expect(finding?.message).toContain('in schema public to PUBLIC, anon applies');
    const all = lint(
      [
        'grant select on all tables in schema public to authenticated;',
        'grant all on all tables in schema public to service_role;',
        'grant select on all tables in schema public to staff, postgres;',
      ].join('\n'),
    );
    expect(all.map((f) => f.line)).toEqual([1, 2]);
    expect(
      lint('grant all on all tables in schema public to backend;', { serviceRole: 'backend' }),
    ).toHaveLength(1);
    expect(
      lint('grant select on all tables in schema public to staff;', { clientRoles: ['staff'] }),
    ).toHaveLength(1);
  });

  it('flags grants only, not revokes', () => {
    expect(lint('revoke all on all tables in schema public from anon;')).toEqual([]);
    expect(
      lint('revoke grant option for select on all tables in schema public from anon;'),
    ).toEqual([]);
    expect(
      lint('grant select on all tables in schema public to anon with grant option;'),
    ).toHaveLength(1);
  });

  it('flags ALL ... IN SCHEMA only, not named relations', () => {
    expect(lint('grant select on public.todos, public.audit_log to anon;')).toEqual([]);
    expect(lint('grant usage on sequence public.audit_log_id_seq to anon;')).toEqual([]);
  });

  it('checks scoped schemas only, and names only those in the message', () => {
    expect(lint('grant select on all tables in schema private to anon;')).toEqual([]);
    const [finding] = lint('grant select on all tables in schema private, public to anon;');
    expect(finding?.message).toContain('in schema public to anon');
    const api = lint('grant select on all tables in schema api, public to anon;', {
      schemas: ['public', 'api'],
    });
    expect(api[0]?.message).toContain('in schema api, public to anon');
  });

  it('counts the objects the grant reached in scoped schemas, even none', () => {
    const [finding] = lint(
      'create schema private;\ncreate table private.jobs (id uuid);\ngrant select on all tables in schema public, private to anon;',
    );
    expect(finding?.message).toContain('(2 relations)');
    const one = lint(
      ['drop table public.audit_log;', 'grant select on all tables in schema public to anon;'].join(
        '\n',
      ),
    );
    expect(one[0]?.message).toContain('(1 relation)');
    const sequence = lint('grant usage on all sequences in schema public to anon;');
    expect(sequence[0]?.message).toContain('(1 sequence)');
    const none = lint(
      'drop table public.todos, public.audit_log;\ngrant select on all tables in schema public to anon;',
    );
    expect(none[0]?.message).toContain('(0 relations)');
  });

  it('gives no fix when the file created none of the objects', () => {
    expect(lines(lint('grant select on all tables in schema public to anon;'))).toEqual(['1 -']);
    const sequences = lint(
      'create table public.orders (id uuid);\ngrant usage on all sequences in schema public to anon;',
    );
    expect(lines(sequences)).toEqual(['2 -']);
  });

  it('writes the fix with the privileges and grantees as written, created objects only', () => {
    const findings = lint(
      [
        'create table public."Order Items" (id uuid, note text);',
        'create table public.orders (id uuid);',
        'grant all on all tables in schema public to anon, "Staff";',
        'create table public.late (id uuid);',
        'grant select (id, "Note"), update (id) on all tables in schema public to authenticated;',
      ].join('\n'),
    );
    expect(lines(findings)).toEqual([
      '3 grant all on public."Order Items", public.orders to anon, "Staff";',
      '5 grant select (id, "Note"), update (id) on public."Order Items", public.orders, public.late to authenticated;',
    ]);
  });

  it('builds the fix from created objects only, whatever else the file records', () => {
    const findings = lint(
      [
        'create sequence public.invoice_no;',
        'alter default privileges for role postgres in schema public grant usage on sequences to anon;',
        'grant usage on all sequences in schema public to anon;',
      ].join('\n'),
    );
    expect(lines(findings)).toEqual(['3 grant usage on sequence public.invoice_no to anon;']);
  });

  it('checks only enforced files', () => {
    const full = { ...DEFAULT_CONFIG, platformDefaults: 'explicit' as const };
    const files = inputs([
      'create table public.todos (id uuid);\ngrant select on all tables in schema public to anon;',
      OPT_IN,
    ]);
    expect(
      runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL005] }).findings,
    ).toEqual([]);
    const none = { ...full, since: 'none' };
    expect(
      runRules({ config: none, replay: replayWithWindow(files, none), rules: [GL005] }).findings,
    ).toHaveLength(1);
  });

  it('reports each statement once, in order', () => {
    const findings = lint(
      [
        'grant select on all tables in schema public to anon, authenticated;',
        'grant usage on all sequences in schema public to anon, authenticated;',
      ].join('\n'),
    );
    expect(findings.map((f) => `${String(f.line)} ${f.role ?? '-'} ${f.relation ?? '-'}`)).toEqual([
      '1 - -',
      '2 - -',
    ]);
  });
});

describe('GL005 in the rule list', () => {
  it('is registered after GL004', () => {
    expect(RULES.map((r) => r.id).slice(1, 6)).toEqual([
      'GL001',
      'GL002',
      'GL003',
      'GL004',
      'GL005',
    ]);
    expect(GL005).toMatchObject({ name: 'blanket-grant', defaultSeverity: 'warn' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL005 +blanket-grant +warn$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL005')).toEqual({
      id: 'GL005',
      name: 'blanket-grant',
      shortDescription: { text: GL005.docs },
      helpUri: docsUrl('GL005'),
      defaultConfiguration: { level: 'warning' },
    });
  });
});
