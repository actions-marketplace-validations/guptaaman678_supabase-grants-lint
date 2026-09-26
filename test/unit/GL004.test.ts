import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { checkedClientRoles } from '../../src/rules/client-roles.js';
import { GL004 } from '../../src/rules/GL004.js';
import { createContext, docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;`;

const ORDERS = 'create table public.orders (id bigserial primary key, total_cents int);';

function inputs(sources: readonly string[]) {
  return sources.map((source, i) => {
    const version = `2026100${String(i + 1)}000000`;
    const file = `supabase/migrations/${version}_m.sql`;
    return { file, version, statements: parser.parse(source, file).statements };
  });
}

/** Lints each source as a migration after an opt-in (the last ones enforced), with GL004 only. */
function lint(sql: string | readonly string[], config: Partial<Config> = {}): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const files = inputs([OPT_IN, ...(typeof sql === 'string' ? [sql] : sql)]);
  return runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL004] }).findings;
}

const summary = (findings: readonly Finding[]) =>
  findings.map((f) => `${f.relation ?? ''} ${f.role ?? ''} ${f.fix ?? ''}`);

describe('GL004 serial-sequence-usage', () => {
  it('states the consequence and the fix, anchored at the CREATE statement', () => {
    const findings = lint(
      ['select 1;', '', `  ${ORDERS}`, 'grant insert on public.orders to authenticated;'].join(
        '\n',
      ),
    );
    expect(findings).toEqual([
      {
        ruleId: 'GL004',
        severity: 'error',
        message:
          'public.orders has serial column id, and authenticated can insert into it but holds no ' +
          'usage (or update) on its sequence public.orders_id_seq: inserts that rely on the column default ' +
          'fail with 42501 permission denied for sequence orders_id_seq. Grant authenticated ' +
          'usage on the sequence in the same migration.',
        file: 'supabase/migrations/20261002000000_m.sql',
        line: 3,
        column: 3,
        relation: 'public.orders',
        role: 'authenticated',
        privilege: 'usage',
        fix: 'grant usage on sequence public.orders_id_seq to authenticated;',
        docsUrl: docsUrl('GL004'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('reports each client role that can insert, own or through PUBLIC', () => {
    expect(summary(lint(`${ORDERS}\ngrant insert on public.orders to public;`))).toEqual([
      'public.orders anon grant usage on sequence public.orders_id_seq to anon;',
      'public.orders authenticated grant usage on sequence public.orders_id_seq to authenticated;',
    ]);
    const anon = lint(`${ORDERS}\ngrant insert on public.orders to anon;`);
    expect(anon.map((f) => f.role)).toEqual(['anon']);
  });

  it('needs insert: select, update or delete alone do not use the sequence', () => {
    const sql = `${ORDERS}\ngrant select, update, delete on public.orders to anon, authenticated;`;
    expect(lint(sql)).toEqual([]);
    expect(lint(`${ORDERS}\ngrant insert (total_cents) on public.orders to anon;`)).toHaveLength(1);
  });

  it('is satisfied by usage own or through PUBLIC, by name or ALL SEQUENCES IN SCHEMA', () => {
    const insert = 'grant insert on public.orders to authenticated;';
    for (const grant of [
      'grant usage on sequence public.orders_id_seq to authenticated;',
      'grant usage on sequence orders_id_seq to public;',
      'grant all on sequence public.orders_id_seq to authenticated;',
      'grant usage on all sequences in schema public to authenticated;',
    ]) {
      expect(lint(`${ORDERS}\n${insert}\n${grant}`), grant).toEqual([]);
    }
  });

  it('is satisfied by update, not by select, on the sequence (ADR-008: nextval accepts either)', () => {
    const insert = 'grant insert on public.orders to authenticated;';
    const select = lint(
      `${ORDERS}\n${insert}\ngrant select on sequence public.orders_id_seq to authenticated;`,
    );
    expect(select.map((f) => f.role)).toEqual(['authenticated']);
    for (const grant of [
      'grant update on sequence public.orders_id_seq to authenticated;',
      'grant update on sequence orders_id_seq to public;',
      'grant update on all sequences in schema public to authenticated;',
    ]) {
      expect(lint(`${ORDERS}\n${insert}\n${grant}`), grant).toEqual([]);
    }
  });

  it('counts grants later in the same file, not grants in a later file', () => {
    const insert = 'grant insert on public.orders to anon;';
    const grant = 'grant usage on sequence public.orders_id_seq to anon;';
    expect(lint(`${ORDERS}\n${insert}\n${grant}`)).toEqual([]);
    const late = lint([`${ORDERS}\n${insert}`, grant]);
    expect(late.map((f) => f.file)).toEqual(['supabase/migrations/20261002000000_m.sql']);
  });

  it('reports every serial column of a table, and ignores identity and uuid keys', () => {
    const findings = lint(
      [
        'create table public.orders (id serial primary key, ticket smallserial, ref uuid default gen_random_uuid(), n int generated always as identity);',
        'grant insert on public.orders to anon;',
      ].join('\n'),
    );
    expect(summary(findings)).toEqual([
      'public.orders anon grant usage on sequence public.orders_id_seq to anon;',
      'public.orders anon grant usage on sequence public.orders_ticket_seq to anon;',
    ]);
    expect(findings[1]?.message).toContain('has serial column ticket,');
  });

  it('follows a renamed table and a renamed sequence', () => {
    const renamed = lint(
      `${ORDERS}\nalter table public.orders rename to purchases;\ngrant insert on public.purchases to anon;`,
    );
    expect(summary(renamed)).toEqual([
      'public.purchases anon grant usage on sequence public.orders_id_seq to anon;',
    ]);
    const sequence = lint(
      `${ORDERS}\ngrant insert on public.orders to anon;\nalter sequence public.orders_id_seq rename to order_numbers;`,
    );
    expect(sequence[0]?.fix).toBe('grant usage on sequence public.order_numbers to anon;');
  });

  it('gives the owned sequence the creator default privileges', () => {
    const sql = [
      'alter default privileges in schema public grant usage on sequences to anon;',
      ORDERS,
      'grant insert on public.orders to anon;',
    ].join('\n');
    expect(lint(sql)).toEqual([]);
  });

  it('checks roles listed in config clientRoles as well as anon and authenticated', () => {
    const sql = `${ORDERS}\ngrant insert on public.orders to staff, anon, service_role;`;
    expect(lint(sql).map((f) => f.role)).toEqual(['anon']);
    expect(lint(sql, { clientRoles: ['staff', 'anon'] }).map((f) => f.role)).toEqual([
      'anon',
      'staff',
    ]);
  });

  it('checks only enforced files, relations created in them, and scoped schemas', () => {
    const full = { ...DEFAULT_CONFIG, platformDefaults: 'explicit' as const };
    const files = inputs([
      `${ORDERS}\ngrant insert on public.orders to anon;`,
      OPT_IN,
      'grant insert on public.orders to authenticated;',
    ]);
    expect(
      runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL004] }).findings,
    ).toEqual([]);
    const none = { ...full, since: 'none' };
    expect(
      runRules({
        config: none,
        replay: replayWithWindow(files, none),
        rules: [GL004],
      }).findings.map((f) => `${f.file} ${f.role ?? ''}`),
    ).toEqual(['supabase/migrations/20261001000000_m.sql anon']);
    expect(
      lint(
        'create schema api;\ncreate table api.orders (id bigserial);\ngrant insert on api.orders to anon;',
      ),
    ).toEqual([]);
  });

  it('exempts a table dropped in the same file', () => {
    const sql = `${ORDERS}\ngrant insert on public.orders to anon;\ndrop table public.orders;`;
    expect(lint(sql)).toEqual([]);
  });

  it('quotes identifiers in the fix only when Postgres needs it', () => {
    const [finding] = lint(
      'create table public."Order Items" (id serial);\ngrant insert on public."Order Items" to "Staff";',
      { clientRoles: ['Staff'] },
    );
    expect(finding?.fix).toBe('grant usage on sequence public."Order Items_id_seq" to "Staff";');
  });
});

describe('checked client roles', () => {
  it('is anon and authenticated plus config clientRoles, without duplicates', () => {
    const files = replayWithWindow([], DEFAULT_CONFIG);
    const roles = (clientRoles: string[]) =>
      checkedClientRoles(createContext({ ...DEFAULT_CONFIG, clientRoles }, files));
    expect(roles(['anon', 'authenticated'])).toEqual(['anon', 'authenticated']);
    expect(roles([])).toEqual(['anon', 'authenticated']);
    expect(roles(['staff', 'anon'])).toEqual(['anon', 'authenticated', 'staff']);
  });
});

describe('GL004 in the rule list', () => {
  it('is registered after GL003', () => {
    expect(RULES.map((r) => r.id).slice(1, 5)).toEqual(['GL001', 'GL002', 'GL003', 'GL004']);
    expect(GL004).toMatchObject({ name: 'serial-sequence-usage', defaultSeverity: 'error' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL004 +serial-sequence-usage +error$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL004')).toEqual({
      id: 'GL004',
      name: 'serial-sequence-usage',
      shortDescription: { text: GL004.docs },
      helpUri: docsUrl('GL004'),
      defaultConfiguration: { level: 'error' },
    });
  });
});
