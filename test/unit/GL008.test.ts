import { beforeAll, describe, expect, it } from 'vitest';
import { usage } from '../../src/cli/usage.js';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { sarifRules } from '../../src/report/sarif.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { GL008, leftoverPrivileges } from '../../src/rules/GL008.js';
import { docsUrl, type Finding, RULES, runRules } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

/** Supabase's announced opt-in: select, insert, update, delete and sequence usage, select only. */
const NARROW_OPT_IN = `alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;`;

const FULL_OPT_IN = `alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;`;

const TODOS = 'create table public.todos (id uuid primary key, title text);';

function inputs(sources: readonly string[]) {
  return sources.map((source, i) => {
    const version = `2026100${String(i + 1)}000000`;
    const file = `supabase/migrations/${version}_m.sql`;
    return { file, version, statements: parser.parse(source, file).statements };
  });
}

/** Lints each source as a migration after an opt-in (the last ones enforced), with GL008 only. */
function lint(
  sql: string | readonly string[],
  config: Partial<Config> = {},
  optIn = NARROW_OPT_IN,
): readonly Finding[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const files = inputs([optIn, ...(typeof sql === 'string' ? [sql] : sql)]);
  return runRules({ config: full, replay: replayWithWindow(files, full), rules: [GL008] }).findings;
}

const fixes = (findings: readonly Finding[]) => findings.map((f) => f.fix);

describe('GL008 leftover-privileges', () => {
  it('states the consequence and the fix, anchored at the CREATE statement', () => {
    const findings = lint(['select 1;', '', `  ${TODOS}`].join('\n'));
    expect(findings).toEqual([
      {
        ruleId: 'GL008',
        severity: 'warn',
        message:
          'public.todos still grants truncate, references, trigger to anon, authenticated, left ' +
          'over from the default privileges: the Data API never needs them, and TRUNCATE and ' +
          'REFERENCES are not subject to row level security. Revoke them in the same migration.',
        file: 'supabase/migrations/20261002000000_m.sql',
        line: 3,
        column: 3,
        relation: 'public.todos',
        fix: 'revoke truncate, references, trigger on public.todos from anon, authenticated;',
        docsUrl: docsUrl('GL008'),
      },
    ]);
    expect(findings[0]?.message).not.toContain(String.fromCodePoint(0x2014)); // G7
  });

  it('reports one finding per relation, naming only the roles and privileges held', () => {
    const findings = lint(`${TODOS}\ngrant references on public.todos to anon;`, {}, FULL_OPT_IN);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('still grants references to anon, left over');
    expect(findings[0]?.role).toBeUndefined();
    expect(findings[0]?.privilege).toBeUndefined();
    // The fix revokes the full list (harmless for privileges not held) from the holders only.
    expect(fixes(findings)).toEqual([
      'revoke truncate, references, trigger on public.todos from anon;',
    ]);
  });

  it('checks each leftover privilege, own or through PUBLIC, column grants included', () => {
    for (const grant of [
      'grant truncate on public.todos to authenticated;',
      'grant trigger on public.todos to authenticated;',
      'grant references (id) on public.todos to authenticated;',
      'grant all on public.todos to authenticated;',
    ]) {
      expect(lint(`${TODOS}\n${grant}`, {}, FULL_OPT_IN), grant).toHaveLength(1);
    }
    const dml = 'grant select, insert, update, delete on public.todos to anon, authenticated;';
    expect(lint(`${TODOS}\n${dml}`, {}, FULL_OPT_IN)).toEqual([]);
  });

  it('revokes from public when the privilege is held through PUBLIC', () => {
    const findings = lint(`${TODOS}\ngrant truncate on public.todos to public;`, {}, FULL_OPT_IN);
    expect(findings[0]?.message).toContain('still grants truncate to anon, authenticated,');
    expect(fixes(findings)).toEqual([
      'revoke truncate, references, trigger on public.todos from public;',
    ]);
    const both = lint(`${TODOS}\ngrant trigger on public.todos to public;`);
    expect(fixes(both)).toEqual([
      'revoke truncate, references, trigger on public.todos from anon, authenticated, public;',
    ]);
  });

  it('counts MAINTAIN only from Postgres 17, where it exists', () => {
    expect(leftoverPrivileges(15)).toEqual(['truncate', 'references', 'trigger']);
    expect(leftoverPrivileges(16)).toEqual(['truncate', 'references', 'trigger']);
    expect(leftoverPrivileges(17)).toEqual(['truncate', 'references', 'trigger', 'maintain']);
    const revoked = `${TODOS}\nrevoke truncate, references, trigger on public.todos from anon, authenticated;`;
    expect(lint(revoked)).toEqual([]);
    const pg17 = lint(revoked, { postgresMajor: 17 });
    expect(pg17[0]?.message).toContain('still grants maintain to anon, authenticated,');
    expect(fixes(pg17)).toEqual([
      'revoke truncate, references, trigger, maintain on public.todos from anon, authenticated;',
    ]);
  });

  it('counts revokes later in the same file, not revokes in a later file', () => {
    const revoke = 'revoke truncate, references, trigger on public.todos from anon, authenticated;';
    expect(lint(`${TODOS}\n${revoke}`)).toEqual([]);
    const late = lint([TODOS, revoke]);
    expect(late.map((f) => f.file)).toEqual(['supabase/migrations/20261002000000_m.sql']);
  });

  it('checks views and follows renames', () => {
    const view = lint(`${TODOS}\ncreate view public.open_todos as select id from public.todos;`);
    expect(view.map((f) => f.relation)).toEqual(['public.todos', 'public.open_todos']);
    const renamed = lint(`${TODOS}\nalter table public.todos rename to tasks;`);
    expect(renamed.map((f) => f.relation)).toEqual(['public.tasks']);
    expect(renamed[0]?.fix).toContain('on public.tasks from');
  });

  it('checks anon, authenticated and config clientRoles, not service_role or other roles', () => {
    const sql = `${TODOS}\ngrant truncate on public.todos to service_role, reporting, staff;`;
    expect(lint(sql, {}, FULL_OPT_IN)).toEqual([]);
    const staff = lint(sql, { clientRoles: ['anon', 'authenticated', 'staff'] }, FULL_OPT_IN);
    expect(fixes(staff)).toEqual([
      'revoke truncate, references, trigger on public.todos from staff;',
    ]);
  });

  it('checks only enforced files, relations created in them, and scoped schemas', () => {
    const files = inputs([TODOS, NARROW_OPT_IN, 'grant truncate on public.todos to anon;']);
    expect(
      runRules({
        config: DEFAULT_CONFIG,
        replay: replayWithWindow(files, DEFAULT_CONFIG),
        rules: [GL008],
      }).findings,
    ).toEqual([]);
    expect(lint('create schema api;\ncreate table api.todos (id uuid primary key);')).toEqual([]);
    expect(lint(`${TODOS}\ndrop table public.todos;`)).toEqual([]);
  });

  it('quotes identifiers in the fix only when Postgres needs it', () => {
    const [finding] = lint(
      'create table public."Todo Items" (id uuid);\ngrant trigger on public."Todo Items" to "Staff";',
      { clientRoles: ['Staff'] },
      FULL_OPT_IN,
    );
    expect(finding?.fix).toBe(
      'revoke truncate, references, trigger on public."Todo Items" from "Staff";',
    );
  });

  it('gives a fix that parses as one REVOKE and clears the finding when appended', () => {
    const cases: [string, Partial<Config>, string][] = [
      [TODOS, {}, NARROW_OPT_IN],
      [TODOS, { postgresMajor: 17 }, NARROW_OPT_IN],
      [`${TODOS}\ngrant truncate on public.todos to public;`, {}, NARROW_OPT_IN],
      [`${TODOS}\ngrant all on public.todos to staff;`, { clientRoles: ['staff'] }, FULL_OPT_IN],
      [
        `${TODOS}\ncreate view public.open_todos as select id from public.todos;`,
        {},
        NARROW_OPT_IN,
      ],
      [
        'create table public."Todo Items" (id uuid);\ngrant trigger on public."Todo Items" to "Staff";',
        { clientRoles: ['Staff'] },
        FULL_OPT_IN,
      ],
    ];
    for (const [sql, config, optIn] of cases) {
      const found = lint(sql, config, optIn);
      expect(found.length, sql).toBeGreaterThan(0);
      const fixSql = found.map((f) => f.fix ?? '').join('\n');
      for (const fix of found.map((f) => f.fix ?? '')) {
        const statements = parser.parse(fix, 'fix.sql').statements;
        expect(
          statements.map((s) => (s.kind === 'Grant' ? s.action : s.kind)),
          fix,
        ).toEqual(['revoke']);
      }
      expect(lint(`${sql}\n${fixSql}`, config, optIn), sql).toEqual([]);
    }
  });
});

describe('GL008 in the rule list', () => {
  it('is registered after GL007', () => {
    expect(RULES.map((r) => r.id).slice(0, 8)).toEqual([
      'GL001',
      'GL002',
      'GL003',
      'GL004',
      'GL005',
      'GL006',
      'GL007',
      'GL008',
    ]);
    expect(GL008).toMatchObject({ name: 'leftover-privileges', defaultSeverity: 'warn' });
  });

  it('appears in --help', () => {
    expect(usage()).toMatch(/^ {2}GL008 +leftover-privileges +warn$/m);
  });

  it('appears in the SARIF rule descriptors', () => {
    expect(sarifRules().find((d) => d.id === 'GL008')).toEqual({
      id: 'GL008',
      name: 'leftover-privileges',
      shortDescription: { text: GL008.docs },
      helpUri: docsUrl('GL008'),
      defaultConfiguration: { level: 'warning' },
    });
  });
});
