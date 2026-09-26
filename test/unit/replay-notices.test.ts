import { beforeAll, describe, expect, it } from 'vitest';
import { type Config, DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import { replayWithWindow } from '../../src/replay/since.js';
import { type Notice, replayNotices } from '../../src/rules/index.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const file = (i: number) => `supabase/migrations/2026100${String(i + 1)}000000_m.sql`;
const V1 = '20261001000000';

function notices(sources: readonly string[], config: Partial<Config> = {}): Notice[] {
  const full = { ...DEFAULT_CONFIG, ...config };
  const inputs = sources.map((source, i) => ({
    file: file(i),
    version: `2026100${String(i + 1)}000000`,
    statements: parser.parse(source, file(i)).statements,
  }));
  return replayNotices(replayWithWindow(inputs, full));
}

const TODOS = 'create table public.todos (id uuid primary key);';
const ORDERS = 'create table public.orders (id uuid primary key);';

describe('replay notices', () => {
  it('reports the platform revoke assumed before the first enforced file (ADR-002 item 1)', () => {
    expect(notices([TODOS, ORDERS], { since: V1 })).toEqual([
      {
        code: 'platform-revoke',
        message:
          `Assumed the platform revoke before this file (since ${V1}): removed the default ` +
          'select, insert, update, delete on new tables and usage, select on new sequences that ' +
          'postgres gave anon, authenticated, service_role in schema public, as opting in from ' +
          'the dashboard or the 2026-10-30 change does. Set platformRevokeAtSince to false if ' +
          'this project still grants them automatically.',
        file: file(1),
        line: 1,
        column: 1,
      },
    ]);
  });

  it('names only what the revoke removed', () => {
    const [notice] = notices(
      [
        'alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;',
        ORDERS,
      ],
      { since: V1 },
    );
    expect(notice?.message).toContain(
      'removed the default select, insert, update, delete on new tables that postgres gave',
    );
  });

  it('reports nothing when no revoke is assumed', () => {
    expect(notices([TODOS, ORDERS])).toEqual([]);
    expect(notices([TODOS, ORDERS], { since: 'none' })).toEqual([]);
    expect(notices([TODOS, ORDERS], { since: V1, platformRevokeAtSince: false })).toEqual([]);
    expect(notices([TODOS, ORDERS], { since: V1, platformDefaults: 'explicit' })).toEqual([]);
  });

  it('reports privileges not valid for the object, which the replay did not record', () => {
    const found = notices([
      `${TODOS}\ngrant usage on public.todos to anon;\n` +
        "do $$ begin execute 'grant select on public.todos to anon'; end $$;\ncreate tabel x ();",
    ]);
    expect(found).toEqual([
      {
        code: 'invalid-privilege',
        message: expect.stringMatching(
          /^Privilege not valid for the object, not recorded: .*usage.*\.$/,
        ) as string,
        file: file(0),
        line: 2,
        column: 1,
      },
    ]);
    expect(found.every((n) => !n.message.includes(String.fromCodePoint(0x2014)))).toBe(true); // G7
  });
});
