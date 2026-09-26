import { beforeAll, describe, expect, it } from 'vitest';
import { DML_PRIVILEGES, TABLE_PRIVILEGES } from '../../src/model/acl.js';
import type { Catalog } from '../../src/model/relations.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import type { PlatformRevokeEvent } from '../../src/replay/context.js';
import type { FileReplay, ReplayInput } from '../../src/replay/engine.js';
import {
  compareVersions,
  detectOptIn,
  isEnforced,
  replayWithWindow,
  type ResolvedSince,
  type WindowedReplay,
  type WindowOptions,
} from '../../src/replay/since.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;

const OPTIONS: WindowOptions = {
  schemas: ['public'],
  migrationRole: 'postgres',
  platformDefaults: 'legacy',
  since: 'auto',
  platformRevokeAtSince: true,
};

function version(n: number): string {
  return `202610010000${String(n).padStart(2, '0')}`;
}

function path(n: number): string {
  return `supabase/migrations/${version(n)}_m${String(n)}.sql`;
}

function inputs(sources: readonly string[]): ReplayInput[] {
  return sources.map((sql, i) => {
    const file = path(i + 1);
    return { file, version: version(i + 1), statements: parser.parse(sql, file).statements };
  });
}

function run(sources: readonly string[], options: Partial<WindowOptions> = {}): WindowedReplay {
  return replayWithWindow(inputs(sources), { ...OPTIONS, ...options });
}

function enforcedFiles(result: WindowedReplay): string[] {
  return result.files.filter((f) => result.isEnforced(f)).map((f) => f.file);
}

function file(result: WindowedReplay, n: number): FileReplay {
  const replayed = result.files[n - 1];
  if (replayed === undefined) throw new Error(`file ${String(n)} was not replayed`);
  return replayed;
}

function held(catalog: Catalog, name: string, role: string): string[] {
  const relation = catalog.relation({ schema: 'public', name });
  if (relation === undefined) throw new Error(`public.${name} is not tracked`);
  return TABLE_PRIVILEGES.filter((p) => relation.acl.holds(role, p));
}

function platformRevokes(result: WindowedReplay): PlatformRevokeEvent[] {
  return result.files.flatMap((f) =>
    f.events.filter((e): e is PlatformRevokeEvent => e.kind === 'platformRevoke'),
  );
}

// A pulled baseline: turns the legacy defaults on explicitly, as `db pull` writes them.
const BASELINE = `
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
create table public.orders (id uuid primary key);
`;

// The opt-in migration: the announced revoke, written in a migration.
const OPT_IN = `
alter default privileges for role postgres in schema public revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke usage, select on sequences from anon, authenticated, service_role;
`;

const NEW_TABLE = 'create table public.todos (id bigint generated always as identity primary key);';

describe('compareVersions', () => {
  it('orders equal-length versions as strings', () => {
    expect(compareVersions('20261001000001', '20261001000002')).toBeLessThan(0);
    expect(compareVersions('20261001000002', '20261001000001')).toBeGreaterThan(0);
    expect(compareVersions('20261001000001', '20261001000001')).toBe(0);
  });

  it('orders versions of different lengths by numeric value', () => {
    expect(compareVersions('9', '10')).toBeLessThan(0);
    expect(compareVersions('10', '9')).toBeGreaterThan(0);
    expect(compareVersions('2', '10')).toBeLessThan(0);
  });

  it('ignores leading zeros', () => {
    expect(compareVersions('007', '7')).toBe(0);
    expect(compareVersions('010', '9')).toBeGreaterThan(0);
    expect(compareVersions('000', '0')).toBe(0);
  });
});

describe('isEnforced', () => {
  const at = (value: string | null): ResolvedSince => ({
    value,
    source: value === null ? null : 'config',
    detected: null,
  });

  it('is strictly greater than since', () => {
    expect(isEnforced(at('5'), '4')).toBe(false);
    expect(isEnforced(at('5'), '5')).toBe(false);
    expect(isEnforced(at('5'), '6')).toBe(true);
  });

  it('enforces every file, with or without a version, under "none"', () => {
    expect(isEnforced(at('none'), '1')).toBe(true);
    expect(isEnforced(at('none'), null)).toBe(true);
  });

  it('enforces nothing when since did not resolve', () => {
    expect(isEnforced(at(null), '99999999999999')).toBe(false);
  });

  it('never enforces a file without a version against a version', () => {
    expect(isEnforced(at('1'), null)).toBe(false);
  });
});

describe('since resolution: precedence', () => {
  const history = [BASELINE, OPT_IN, NEW_TABLE, NEW_TABLE.replace('todos', 'messages')];

  it('auto-detects the opt-in migration when neither flag nor config sets since', () => {
    const result = run(history);
    expect(result.since).toEqual({
      value: version(2),
      source: 'auto',
      detected: { file: path(2), at: { file: path(2), line: 2, column: 1 } },
    });
    expect(enforcedFiles(result)).toEqual([path(3), path(4)]);
  });

  it('uses a config version over auto-detection', () => {
    const result = run(history, { since: version(3) });
    expect(result.since).toEqual({ value: version(3), source: 'config', detected: null });
    expect(enforcedFiles(result)).toEqual([path(4)]);
  });

  it('uses the CLI flag over a config version', () => {
    const result = run(history, { since: version(3), cliSince: version(1) });
    expect(result.since).toEqual({ value: version(1), source: 'cli', detected: null });
    expect(enforcedFiles(result)).toEqual([path(2), path(3), path(4)]);
  });

  it('uses the CLI flag over config "none"', () => {
    const result = run(history, { since: 'none', cliSince: version(3) });
    expect(result.since.source).toBe('cli');
    expect(enforcedFiles(result)).toEqual([path(4)]);
  });

  it('lets the CLI flag ask for auto-detection over a config version', () => {
    const result = run(history, { since: version(3), cliSince: 'auto' });
    expect(result.since.source).toBe('auto');
    expect(result.since.value).toBe(version(2));
  });

  it('enforces every file under config "none", even with an opt-in in the history', () => {
    const result = run(history, { since: 'none' });
    expect(result.since).toEqual({ value: 'none', source: 'config', detected: null });
    expect(enforcedFiles(result)).toEqual(history.map((_, i) => path(i + 1)));
  });

  it('enforces every file under --since none', () => {
    const result = run(history, { since: version(3), cliSince: 'none' });
    expect(result.since).toEqual({ value: 'none', source: 'cli', detected: null });
    expect(enforcedFiles(result)).toHaveLength(4);
  });

  it('accepts a configured version that matches no file', () => {
    const result = run(history, { since: '20261001000002500' });
    expect(enforcedFiles(result)).toEqual([]);
    const between = run(history, { since: '2026100100000' });
    expect(enforcedFiles(between)).toHaveLength(4);
  });
});

describe('since resolution: auto-detection', () => {
  it('resolves nothing when no file opts in (the GL000 path)', () => {
    const result = run([BASELINE, NEW_TABLE]);
    expect(result.since).toEqual({ value: null, source: null, detected: null });
    expect(enforcedFiles(result)).toEqual([]);
  });

  it('resolves nothing for an empty history', () => {
    const result = run([]);
    expect(result.since.value).toBeNull();
    expect(result.files).toEqual([]);
  });

  it('picks the last of several opt-in files', () => {
    const result = run([OPT_IN, BASELINE, OPT_IN, NEW_TABLE]);
    expect(result.since.value).toBe(version(3));
    expect(result.since.detected?.file).toBe(path(3));
    expect(enforcedFiles(result)).toEqual([path(4)]);
  });

  it('does not treat a revoke from only some of the roles as an opt-in', () => {
    const partial = `
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
`;
    const result = run([BASELINE, partial, NEW_TABLE]);
    expect(result.since.value).toBeNull();
    const laterPartial = run([BASELINE, OPT_IN, partial, NEW_TABLE]);
    expect(laterPartial.since.value).toBe(version(2));
  });

  it('accepts the revoke spread over several statements of one file', () => {
    const spread = `
alter default privileges in schema public revoke select, insert on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke update, delete on tables from anon;
alter default privileges for role postgres in schema public revoke update, delete on tables from authenticated, service_role;
`;
    const result = run([BASELINE, spread, NEW_TABLE]);
    expect(result.since.value).toBe(version(2));
    expect(result.since.detected?.at.line).toBe(2);
  });

  it('accepts revoke all, a revoke without IN SCHEMA, and PUBLIC listed among the grantees', () => {
    const all = `alter default privileges for role postgres revoke all on tables from public, anon, authenticated, service_role;`;
    expect(run([BASELINE, all]).since.value).toBe(version(2));
  });

  it('does not count a revoke that leaves any of select, insert, update, delete', () => {
    for (const kept of DML_PRIVILEGES) {
      const privileges = DML_PRIVILEGES.filter((p) => p !== kept).join(', ');
      const narrow = `alter default privileges in schema public revoke ${privileges}, truncate on tables from anon, authenticated, service_role;`;
      expect(run([BASELINE, narrow]).since.value, `without ${kept}`).toBeNull();
    }
  });

  it('does not count revokes of sequences, of grant options, or of grants', () => {
    const cases = [
      'alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;',
      'alter default privileges in schema public revoke grant option for all on tables from anon, authenticated, service_role;',
      'alter default privileges in schema public grant all on tables to anon, authenticated, service_role;',
    ];
    for (const sql of cases) expect(run([BASELINE, sql]).since.value, sql).toBeNull();
    // A sequence revoke does not complete a table revoke, even of privileges both kinds have.
    const mixed = `
alter default privileges in schema public revoke insert, delete on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke select, update on sequences from anon, authenticated, service_role;
`;
    expect(run([BASELINE, mixed]).since.value).toBeNull();
  });

  it('only counts revokes for the migration role', () => {
    const other = `alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role;`;
    expect(run([BASELINE, other]).since.value).toBeNull();
    const setRole = `set role supabase_admin;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;`;
    expect(run([BASELINE, setRole]).since.value).toBeNull();
    expect(run([BASELINE, other], { migrationRole: 'supabase_admin' }).since.value).toBe(
      version(2),
    );
  });

  it('only counts revokes in a configured schema', () => {
    const elsewhere = `alter default privileges in schema private revoke all on tables from anon, authenticated, service_role;`;
    expect(run([BASELINE, elsewhere]).since.value).toBeNull();
    expect(run([BASELINE, elsewhere], { schemas: ['public', 'private'] }).since.value).toBe(
      version(2),
    );
    const listed = `alter default privileges in schema private, public revoke all on tables from anon, authenticated, service_role;`;
    expect(run([BASELINE, listed]).since.value).toBe(version(2));
  });

  it('ignores an opt-in in a file without a version', () => {
    const files: ReplayInput[] = [
      ...inputs([BASELINE, OPT_IN]),
      {
        file: 'supabase/migrations/manual_opt_in.sql',
        version: null,
        statements: parser.parse(OPT_IN, 'supabase/migrations/manual_opt_in.sql').statements,
      },
    ];
    const result = replayWithWindow(files, OPTIONS);
    expect(result.since.value).toBe(version(2));
    expect(result.files.filter((f) => result.isEnforced(f))).toEqual([]);
    const none = replayWithWindow(files.slice(2), OPTIONS);
    expect(none.since.value).toBeNull();
  });

  it('detectOptIn reads the replayed files directly (for doctor)', () => {
    const result = run([BASELINE, OPT_IN, NEW_TABLE]);
    expect(detectOptIn(result.files, OPTIONS)).toEqual({
      file: path(2),
      version: version(2),
      at: { file: path(2), line: 2, column: 1 },
    });
  });

  it('never applies the platform revoke when since is auto-detected', () => {
    const result = run([BASELINE, NEW_TABLE]);
    expect(platformRevokes(result)).toEqual([]);
    for (const role of API_ROLES)
      expect(held(result.final, 'todos', role)).toEqual(TABLE_PRIVILEGES);
  });
});

describe('since resolution: platform revoke at the boundary (ADR-002 item 1)', () => {
  // A dashboard-opted-in project: its history re-grants in the pulled baseline and never revokes.
  const history = [BASELINE, NEW_TABLE];

  it('assumes the announced revoke before the first enforced file when since is configured', () => {
    const result = run(history, { since: version(1) });
    expect(platformRevokes(result)).toEqual([
      {
        kind: 'platformRevoke',
        at: { file: path(2), line: 1, column: 1 },
        creator: 'postgres',
        schema: 'public',
        removed: [
          ...API_ROLES.map((grantee) => ({
            object: 'table',
            grantee,
            privileges: ['select', 'insert', 'update', 'delete'],
          })),
          ...API_ROLES.map((grantee) => ({
            object: 'sequence',
            grantee,
            privileges: ['usage', 'select'],
          })),
        ],
      },
    ]);
    // The new table gets only the privileges the platform revoke leaves (differentiator 2).
    for (const role of API_ROLES) {
      expect(held(result.final, 'todos', role)).toEqual([
        'truncate',
        'references',
        'trigger',
        'maintain',
      ]);
    }
    // History before the boundary keeps what it had.
    expect(held(file(result, 1).after, 'orders', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(
      file(result, 2).before.defaults.effective('postgres', 'public', 'table').privileges('anon'),
    ).toEqual(['maintain', 'references', 'trigger', 'truncate']);
  });

  it('assumes the revoke when since comes from the CLI flag', () => {
    const result = run(history, { cliSince: version(1) });
    expect(platformRevokes(result)).toHaveLength(1);
    expect(held(result.final, 'todos', 'service_role')).not.toContain('select');
  });

  it('keeps the legacy grants when platformRevokeAtSince is false', () => {
    const result = run(history, { since: version(1), platformRevokeAtSince: false });
    expect(platformRevokes(result)).toEqual([]);
    for (const role of API_ROLES)
      expect(held(result.final, 'todos', role)).toEqual(TABLE_PRIVILEGES);
  });

  it('applies to the initial legacy state as well as to a baseline re-grant', () => {
    const result = run([NEW_TABLE, NEW_TABLE.replace('todos', 'messages')], { since: version(1) });
    expect(platformRevokes(result).map((e) => e.at.file)).toEqual([path(2)]);
    expect(held(result.final, 'todos', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(held(result.final, 'messages', 'anon')).not.toContain('select');
  });

  it('records nothing when the defaults are already revoked', () => {
    const result = run([BASELINE, OPT_IN, NEW_TABLE], { since: version(2) });
    expect(platformRevokes(result)).toEqual([]);
  });

  it('records only what it removed', () => {
    const narrowed = `alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke insert, update, delete on tables from anon, authenticated;`;
    const result = run([BASELINE, narrowed, NEW_TABLE], { since: version(2) });
    expect(platformRevokes(result)[0]?.removed).toEqual([
      { object: 'table', grantee: 'anon', privileges: ['select'] },
      { object: 'table', grantee: 'authenticated', privileges: ['select'] },
      {
        object: 'table',
        grantee: 'service_role',
        privileges: ['select', 'insert', 'update', 'delete'],
      },
    ]);
  });

  it('does not remove a default granted for all schemas, as in Postgres', () => {
    const allSchemas = `alter default privileges for role postgres grant select on tables to anon;`;
    const result = run([allSchemas, NEW_TABLE], {
      since: version(1),
      platformDefaults: 'explicit',
    });
    expect(platformRevokes(result)).toEqual([]);
    expect(held(result.final, 'todos', 'anon')).toEqual(['select']);
  });

  it('revokes for the configured migration role', () => {
    const baseline = BASELINE.replaceAll('for role postgres', 'for role app_owner');
    const result = run([baseline, NEW_TABLE], {
      since: version(1),
      migrationRole: 'app_owner',
      platformDefaults: 'explicit',
    });
    expect(platformRevokes(result)[0]?.creator).toBe('app_owner');
    expect(held(result.final, 'todos', 'anon')).not.toContain('select');
  });

  it('is not applied under "none" or when no file is enforced', () => {
    expect(platformRevokes(run(history, { since: 'none' }))).toEqual([]);
    expect(platformRevokes(run(history, { since: version(2) }))).toEqual([]);
    expect(platformRevokes(run(history, { since: version(9) }))).toEqual([]);
  });

  it('is applied before a boundary file that is not the first file', () => {
    const result = run([BASELINE, NEW_TABLE.replace('todos', 'messages'), NEW_TABLE], {
      since: version(2),
    });
    expect(platformRevokes(result).map((e) => e.at.file)).toEqual([path(3)]);
    expect(held(result.final, 'messages', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(held(result.final, 'todos', 'anon')).not.toContain('select');
  });
});
