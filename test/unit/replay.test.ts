import { beforeAll, describe, expect, it } from 'vitest';
import {
  DML_PRIVILEGES,
  type Grantee,
  privilegesFor,
  PUBLIC,
  SEQUENCE_PRIVILEGES,
  TABLE_PRIVILEGES,
} from '../../src/model/acl.js';
import type { Catalog } from '../../src/model/relations.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import type { ReplayEvent } from '../../src/replay/context.js';
import {
  type EngineOptions,
  type FileReplay,
  replay,
  type ReplayInput,
  type ReplayResult,
} from '../../src/replay/engine.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

const API_ROLES = ['anon', 'authenticated', 'service_role'] as const;

const OPTIONS: EngineOptions = {
  schemas: ['public'],
  migrationRole: 'postgres',
  platformDefaults: 'legacy',
};

function version(n: number): string {
  return `202610010000${String(n).padStart(2, '0')}`;
}

function path(n: number): string {
  return `supabase/migrations/${version(n)}_m${String(n)}.sql`;
}

function inputs(sources: readonly string[], first = 1): ReplayInput[] {
  return sources.map((sql, i) => {
    const file = path(first + i);
    return { file, version: version(first + i), statements: parser.parse(sql, file).statements };
  });
}

function run(sources: readonly string[], options: Partial<EngineOptions> = {}): ReplayResult {
  return replay(inputs(sources), { ...OPTIONS, ...options });
}

/** The replay of the last file. */
function last(result: ReplayResult): FileReplay {
  const file = result.files.at(-1);
  if (file === undefined) throw new Error('no files replayed');
  return file;
}

function split(qualified: string): { schema: string; name: string } {
  const [schema = '', name = ''] = qualified.split('.');
  return { schema, name };
}

/** Effective table privileges (own union PUBLIC) of `role` on a tracked relation. */
function held(catalog: Catalog, relation: string, role: Grantee): string[] {
  const tracked = catalog.relation(split(relation));
  if (tracked === undefined) throw new Error(`${relation} is not tracked`);
  return TABLE_PRIVILEGES.filter((p) => tracked.acl.holds(role, p));
}

function heldOnSequence(catalog: Catalog, sequence: string, role: Grantee): string[] {
  const tracked = catalog.sequence(split(sequence));
  if (tracked === undefined) throw new Error(`${sequence} is not tracked`);
  return SEQUENCE_PRIVILEGES.filter((p) => tracked.acl.holds(role, p));
}

function tracked(catalog: Catalog): string[] {
  return catalog.relations().map((r) => `${r.schema}.${r.name}`);
}

function createdIn(file: FileReplay): string[] {
  return file.created.map((r) => `${r.schema}.${r.name}`);
}

function eventsOf<K extends ReplayEvent['kind']>(
  file: FileReplay,
  kind: K,
): Extract<ReplayEvent, { kind: K }>[] {
  return file.events.filter((e): e is Extract<ReplayEvent, { kind: K }> => e.kind === kind);
}

// A two-file base in the shape the reference used: file 1 is a pulled baseline that turns the
// legacy defaults on and creates three relations (one deliberately narrowed); file 2 is the opt-in.
const BASELINE = `
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
create table public.orders (id uuid primary key);
create view public.order_totals as select 1 as x;
create table public.audit_log (id uuid primary key);
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
`;

const OPT_IN = `
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
`;

/** Replays the base, then `files`, starting from no default privileges (as the reference did). */
function withBase(...files: string[]): ReplayResult {
  return run([BASELINE, OPT_IN, ...files], { platformDefaults: 'explicit' });
}

describe('replay: base history (reference H1, H3 shapes)', () => {
  it('turns legacy defaults on with the baseline and off with the opt-in', () => {
    const [baseline, optIn] = withBase().files;
    for (const role of API_ROLES) {
      const tables = baseline?.after.defaults.effective('postgres', 'public', 'table');
      expect(DML_PRIVILEGES.every((p) => tables?.holds(role, p))).toBe(true);
      expect(
        baseline?.after.defaults.effective('postgres', 'public', 'sequence').holds(role, 'usage'),
      ).toBe(true);
    }
    expect(optIn?.after.defaults.effective('postgres', 'public', 'table').isEmpty).toBe(true);
    expect(optIn?.after.defaults.effective('postgres', 'public', 'sequence').isEmpty).toBe(true);
    expect(optIn?.after.defaults.entries()).toEqual([]);
  });

  it("reproduces the base's grants: full DML everywhere except the narrowed table", () => {
    const { final } = withBase();
    expect(tracked(final)).toEqual(['public.orders', 'public.order_totals', 'public.audit_log']);
    for (const relation of ['public.orders', 'public.order_totals']) {
      for (const role of API_ROLES) expect(held(final, relation, role)).toEqual(TABLE_PRIVILEGES);
    }
    expect(held(final, 'public.audit_log', 'anon')).toEqual([]);
    expect(held(final, 'public.audit_log', 'authenticated')).toEqual(['select']);
    expect(held(final, 'public.audit_log', 'service_role')).toEqual(TABLE_PRIVILEGES);
  });

  it('starts from the legacy platform defaults when platformDefaults is legacy', () => {
    const result = run(['create table public.todos (id uuid);']);
    for (const role of API_ROLES) {
      expect(held(result.final, 'public.todos', role)).toEqual(TABLE_PRIVILEGES);
    }
    expect(result.initial.defaults.entries()).toHaveLength(2);
  });

  it('starts from no default privileges when platformDefaults is explicit', () => {
    const result = run(['create table public.todos (id uuid);'], { platformDefaults: 'explicit' });
    for (const role of API_ROLES) expect(held(result.final, 'public.todos', role)).toEqual([]);
    expect(result.initial.defaults.entries()).toEqual([]);
  });
});

describe('replay: reference fixture cases', () => {
  it('F1: a new table or view gets nothing for service_role after the opt-in', () => {
    const table = last(withBase('create table public.todos (id uuid primary key);'));
    expect(createdIn(table)).toEqual(['public.todos']);
    expect(held(table.after, 'public.todos', 'service_role')).toEqual([]);

    const view = last(withBase('create view public.todo_view as select 1 as x;'));
    expect(createdIn(view)).toEqual(['public.todo_view']);
    expect(view.after.relation(split('public.todo_view'))?.kind).toBe('view');
    expect(held(view.after, 'public.todo_view', 'service_role')).toEqual([]);

    const clientOnly = last(
      withBase(
        'create table public.todos (id uuid); grant all on public.todos to anon, authenticated;',
      ),
    );
    expect(held(clientOnly.after, 'public.todos', 'service_role')).toEqual([]);
    expect(held(clientOnly.after, 'public.todos', 'anon')).toEqual(TABLE_PRIVILEGES);
  });

  it('F2: every spelling of the grant reaches the model', () => {
    const cases: [string, string[]][] = [
      [
        'create table public.todos (id uuid); grant select, insert, update, delete on public.todos to service_role;',
        ['public.todos'],
      ],
      [
        'create table if not exists "public"."todos" (id uuid); grant all on table "public"."todos" to "service_role";',
        ['public.todos'],
      ],
      [
        'create table todos (id uuid); grant all privileges on todos to authenticated, service_role;',
        ['public.todos'],
      ],
      [
        'create table public.todos (id uuid); create table public.messages (id uuid);\ngrant select, insert, update, delete on public.todos, public.messages to service_role;',
        ['public.todos', 'public.messages'],
      ],
      [
        'create table public.todos (id uuid);\ngrant\n  select,\n  insert,\n  update,\n  delete\non\n  public.todos\nto\n  service_role;',
        ['public.todos'],
      ],
    ];
    for (const [sql, relations] of cases) {
      const file = last(withBase(sql));
      expect(createdIn(file)).toEqual(relations);
      for (const relation of relations) {
        expect(held(file.after, relation, 'service_role')).toEqual(
          expect.arrayContaining([...DML_PRIVILEGES]),
        );
      }
    }
  });

  it('F3: comments, string literals and function bodies neither grant nor create', () => {
    const commented = [
      'create table public.todos (id uuid);\n-- grant all on public.todos to service_role;',
      'create table public.todos (id uuid);\n/* grant all on public.todos to service_role; */',
    ];
    for (const sql of commented) {
      expect(held(last(withBase(sql)).after, 'public.todos', 'service_role')).toEqual([]);
    }
    const inert = [
      '-- create table public.todos (id uuid);',
      "comment on table public.orders is 'see note; create table public.todos (id uuid); it''s fine';",
      'create function public.f() returns void language plpgsql as $$ begin perform 1; create table public.todos (id int); end $$;',
      'create function public.f() returns void language plpgsql as $fn$ begin perform 1; create table public.todos (id int); end $fn$;',
    ];
    for (const sql of inert) {
      const file = last(withBase(sql));
      expect(createdIn(file)).toEqual([]);
      expect(file.after.relation(split('public.todos'))).toBeUndefined();
    }
  });

  it('F4: only new relations in scope count as created in the file', () => {
    const outOfScope = last(withBase('create table private.todos (id uuid);'));
    expect(createdIn(outOfScope)).toEqual([]);
    expect(outOfScope.after.relation(split('private.todos'))).toBeDefined();

    const temporary = last(withBase('create temp table todos (id uuid);'));
    expect(createdIn(temporary)).toEqual([]);
    expect(temporary.after.relation(split('public.todos'))).toBeUndefined();

    const replaced = last(withBase('create or replace view public.order_totals as select 2 as x;'));
    expect(createdIn(replaced)).toEqual([]);
    expect(held(replaced.after, 'public.order_totals', 'anon')).toEqual(TABLE_PRIVILEGES);

    const existing = last(withBase('create table if not exists public.orders (id uuid);'));
    expect(createdIn(existing)).toEqual([]);
    expect(held(existing.after, 'public.orders', 'anon')).toEqual(TABLE_PRIVILEGES);

    const recreated = last(
      withBase('drop table if exists public.orders; create table public.orders (id uuid);'),
    );
    expect(createdIn(recreated)).toEqual(['public.orders']);
    for (const role of API_ROLES) expect(held(recreated.after, 'public.orders', role)).toEqual([]);
  });

  it('F5: a grant in a later file is not in the earlier file snapshot', () => {
    const result = withBase(
      'create table public.todos (id uuid);',
      'grant all on public.todos to service_role;',
    );
    const [, , first, second] = result.files;
    expect(first && createdIn(first)).toEqual(['public.todos']);
    expect(first && held(first.after, 'public.todos', 'service_role')).toEqual([]);
    expect(second && createdIn(second)).toEqual([]);
    expect(second && held(second.after, 'public.todos', 'service_role')).toEqual(TABLE_PRIVILEGES);
  });

  it('F6: policies are recorded with their command and roles, next to the grants', () => {
    const table = 'create table public.todos (id uuid); grant all on public.todos to service_role;';
    const noGrant = last(
      withBase(
        `${table} create policy p on public.todos for select to authenticated using (true);`,
      ),
    );
    expect(noGrant.policies).toMatchObject([
      { name: 'p', command: 'select', roles: ['authenticated'] },
    ]);
    expect(held(noGrant.after, 'public.todos', 'authenticated')).toEqual([]);

    const defaults = last(withBase(`${table} create policy p on public.todos using (true);`));
    expect(defaults.policies).toMatchObject([{ command: 'all', roles: [PUBLIC] }]);

    const anonOnly = last(
      withBase(
        `${table} grant select on public.todos to anon; create policy p on public.todos for select using (true);`,
      ),
    );
    expect(held(anonOnly.after, 'public.todos', 'anon')).toEqual(['select']);
    expect(held(anonOnly.after, 'public.todos', 'authenticated')).toEqual([]);

    const grantOption = last(
      withBase(
        `${table} grant select on public.todos to authenticated with grant option; revoke grant option for select on public.todos from authenticated; create policy p on public.todos for select to authenticated using (true);`,
      ),
    );
    expect(held(grantOption.after, 'public.todos', 'authenticated')).toEqual(['select']);
    expect(eventsOf(grantOption, 'grant').map((e) => e.grantOptionOnly)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('F7: policies on existing, unknown and out-of-scope relations', () => {
    const existing = last(
      withBase(
        'create policy p on public.orders for select to authenticated using (true); create policy q on public.audit_log for insert to authenticated with check (true);',
      ),
    );
    expect(existing.policies.map((p) => `${p.relation.name}:${p.command}`)).toEqual([
      'orders:select',
      'audit_log:insert',
    ]);
    expect(held(existing.after, 'public.audit_log', 'authenticated')).toEqual(['select']);

    const unknown = last(
      withBase('create policy p on public.nowhere for select to authenticated using (true);'),
    );
    expect(unknown.policies.map((p) => p.relation.name)).toEqual(['nowhere']);
    expect(unknown.after.relation(split('public.nowhere'))).toBeUndefined();

    const outOfScope = last(
      withBase('create policy p on storage.objects for select to authenticated using (true);'),
    );
    expect(outOfScope.policies).toEqual([]);
    expect(outOfScope.after.policies().map((p) => p.relation.schema)).toEqual(['storage']);
  });

  it('F8: a rename carries the grants, the created marker and the policies', () => {
    const result = withBase(
      'create table public.todos (id uuid); grant all on public.todos to service_role, authenticated; create policy p on public.todos for select to authenticated using (true);',
      'alter table public.todos rename to tasks; create policy q on public.tasks for select to authenticated using (true);',
    );
    const [, , first, second] = result.files;
    expect(second?.after.relation(split('public.todos'))).toBeUndefined();
    expect(second && held(second.after, 'public.tasks', 'authenticated')).toEqual(TABLE_PRIVILEGES);
    expect(second?.after.relation(split('public.tasks'))?.created?.file).toBe(first?.file);
    expect(second && createdIn(second)).toEqual([]);
    expect(second?.after.policiesOn(split('public.tasks')).map((p) => p.name)).toEqual(['p', 'q']);
    expect(second?.policies.map((p) => p.name)).toEqual(['q']);
    expect(eventsOf(second as FileReplay, 'moved')).toMatchObject([
      { object: 'relation', from: split('public.todos'), to: split('public.tasks') },
    ]);

    const sameFile = last(
      withBase('create table public.todos (id uuid); alter table public.todos rename to tasks;'),
    );
    expect(createdIn(sameFile)).toEqual(['public.tasks']);
  });

  it('F9: a serial column creates its owned sequence with the creator defaults', () => {
    const table =
      'create table public.todos (id bigserial primary key); grant all on public.todos to service_role; grant select, insert on public.todos to authenticated;';
    const plain = last(withBase(table));
    const sequence = plain.after.sequence(split('public.todos_id_seq'));
    expect(sequence?.ownedBy).toEqual({ relation: split('public.todos'), column: 'id' });
    expect(heldOnSequence(plain.after, 'public.todos_id_seq', 'authenticated')).toEqual([]);
    expect(held(plain.after, 'public.todos', 'authenticated')).toEqual(['select', 'insert']);

    const granted = last(
      withBase(`${table} grant usage on sequence public.todos_id_seq to authenticated;`),
    );
    expect(heldOnSequence(granted.after, 'public.todos_id_seq', 'authenticated')).toEqual([
      'usage',
    ]);

    const identity = last(
      withBase(
        'create table public.todos (id bigint generated always as identity primary key, ref uuid default gen_random_uuid()); grant insert on public.todos to authenticated;',
      ),
    );
    expect(identity.after.sequences()).toEqual([]);

    const legacy = run(['create table public.todos (id serial primary key);']);
    for (const role of API_ROLES) {
      expect(heldOnSequence(legacy.final, 'public.todos_id_seq', role)).toEqual(
        SEQUENCE_PRIVILEGES,
      );
    }
  });

  it('F10: a blanket grant re-grants every relation existing at that point, in its schemas only', () => {
    const result = withBase(
      'create table private.secrets (id uuid); grant select on all tables in schema public to anon; create table public.todos (id uuid);',
    );
    const file = last(result);
    const [event] = eventsOf(file, 'grant');
    expect(event?.allInSchemas).toEqual(['public']);
    expect(event).toMatchObject({
      objectKind: 'table',
      written: [{ name: 'select', columns: null }],
    });
    expect(event?.targets.map((t) => t.name.name)).toEqual(['orders', 'order_totals', 'audit_log']);
    expect(held(file.after, 'public.audit_log', 'anon')).toEqual(['select']);
    expect(held(file.after, 'public.todos', 'anon')).toEqual([]);
    expect(held(file.after, 'private.secrets', 'anon')).toEqual([]);

    const other = last(withBase('grant all on all tables in schema private to service_role;'));
    expect(eventsOf(other, 'grant')[0]?.targets).toEqual([]);

    const sequences = last(
      withBase(
        'create table public.todos (id serial); grant usage on all sequences in schema public to authenticated;',
      ),
    );
    expect(eventsOf(sequences, 'grant')[0]).toMatchObject({
      objectKind: 'sequence',
      written: [{ name: 'usage', columns: null }],
      allInSchemas: ['public'],
      targets: [{ object: 'sequence', name: split('public.todos_id_seq') }],
    });
    expect(heldOnSequence(sequences.after, 'public.todos_id_seq', 'authenticated')).toEqual([
      'usage',
    ]);
  });

  it('F11: re-granted default privileges are followed by the model', () => {
    const regrant = last(
      withBase(
        'alter default privileges in schema public grant all on tables to service_role; create table public.todos (id uuid);',
      ),
    );
    expect(held(regrant.after, 'public.todos', 'service_role')).toEqual(TABLE_PRIVILEGES);
    expect(held(regrant.after, 'public.todos', 'anon')).toEqual([]);
    expect(eventsOf(regrant, 'defaultPrivileges')).toMatchObject([
      {
        action: 'grant',
        creators: ['postgres'],
        schemas: ['public'],
        object: 'table',
        grantees: ['service_role'],
        privileges: TABLE_PRIVILEGES,
      },
    ]);

    const revoke = last(
      withBase(
        'alter default privileges for role postgres in schema public revoke all on tables from anon;',
      ),
    );
    expect(eventsOf(revoke, 'defaultPrivileges')).toMatchObject([
      { action: 'revoke', creators: ['postgres'], grantees: ['anon'] },
    ]);

    const functions = last(
      withBase(
        'alter default privileges in schema public grant execute on functions to authenticated;',
      ),
    );
    expect(functions.events).toEqual([]);
    expect(functions.after.defaults.entries()).toEqual([]);
  });
});

describe('replay: CREATE', () => {
  it('tracks every relation kind, including AS, PARTITION OF and foreign tables', () => {
    const file = last(
      run([
        `create table public.orders (id int, region text) partition by list (region);
         create table public.orders_eu partition of public.orders for values in ('eu');
         create table public.order_copy as select * from public.orders;
         create materialized view public.order_stats as select count(*) from public.orders;
         create foreign table public.remote_orders (id int) server remote;
         create or replace view public.order_view as select 1 as x;`,
      ]),
    );
    expect(file.created.map((r) => `${r.name}:${r.kind}`)).toEqual([
      'orders:table',
      'orders_eu:table',
      'order_copy:table',
      'order_stats:materialized view',
      'remote_orders:foreign table',
      'order_view:view',
    ]);
    expect(held(file.after, 'public.orders_eu', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(eventsOf(file, 'created').every((e) => e.creator === 'postgres')).toBe(true);
  });

  it('creates an owned sequence for every serial type', () => {
    const file = last(
      run([
        'create table public.todos (a smallserial, b serial, c bigserial, d serial2, e serial4, f serial8, g int);',
      ]),
    );
    expect(file.after.ownedSequences(split('public.todos')).map((s) => s.name)).toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => `todos_${c}_seq`),
    );
    expect(eventsOf(file, 'created').filter((e) => e.object === 'sequence')).toHaveLength(6);
  });

  it('keeps an existing sequence when a serial column would take its name', () => {
    const file = last(
      run([
        'create sequence public.todos_id_seq; revoke all on sequence public.todos_id_seq from anon; create table public.todos (id serial);',
      ]),
    );
    expect(file.after.sequence(split('public.todos_id_seq'))?.ownedBy).toBeNull();
    expect(heldOnSequence(file.after, 'public.todos_id_seq', 'anon')).toEqual([]);
  });

  it('tracks CREATE SEQUENCE with the creator defaults, and IF NOT EXISTS is a no-op', () => {
    const file = last(
      run([
        'create sequence public.invoice_no; revoke usage on sequence public.invoice_no from anon; create sequence if not exists public.invoice_no; create temp sequence scratch;',
      ]),
    );
    expect(file.after.sequences().map((s) => s.name)).toEqual(['invoice_no']);
    expect(heldOnSequence(file.after, 'public.invoice_no', 'anon')).toEqual(['select', 'update']);
    expect(heldOnSequence(file.after, 'public.invoice_no', 'service_role')).toEqual(
      SEQUENCE_PRIVILEGES,
    );
  });

  it('keeps the first relation on a plain duplicate CREATE', () => {
    const file = last(
      run([
        'create table public.todos (id int); revoke all on public.todos from anon; create table public.todos (id int);',
      ]),
    );
    expect(eventsOf(file, 'created')).toHaveLength(1);
    expect(held(file.after, 'public.todos', 'anon')).toEqual([]);
  });
});

describe('replay: RENAME and SET SCHEMA', () => {
  it('moving out of scope removes the relation from the scoped view, moving in adds it with its ACL', () => {
    const result = run([
      'create table public.todos (id serial); create table private.orders (id int); revoke all on private.orders from anon;',
      'alter table public.todos set schema private; alter table private.orders set schema public;',
    ]);
    const second = last(result);
    expect(second.after.relation(split('public.todos'))).toBeUndefined();
    expect(second.after.relation(split('private.todos'))).toBeDefined();
    expect(second.after.sequence(split('private.todos_id_seq'))).toBeDefined();
    expect(result.inScope(split('private.todos'))).toBe(false);
    expect(held(second.after, 'public.orders', 'anon')).toEqual([]);
    expect(held(second.after, 'public.orders', 'authenticated')).toEqual([]);
    expect(second.after.relation(split('public.orders'))?.created?.file).toBe(path(1));
  });

  it('renames sequences, including through ALTER TABLE, and keeps their ACL', () => {
    const file = last(
      run([
        `create sequence public.invoice_no; grant usage on sequence public.invoice_no to authenticated;
         alter sequence public.invoice_no rename to invoice_seq;
         alter table public.invoice_seq rename to invoice_counter;
         alter sequence public.invoice_counter set schema billing;`,
      ]),
    );
    expect(file.after.sequences().map((s) => `${s.schema}.${s.name}`)).toEqual([
      'billing.invoice_counter',
    ]);
    expect(eventsOf(file, 'moved').map((e) => e.to.name)).toEqual([
      'invoice_seq',
      'invoice_counter',
      'invoice_counter',
    ]);
  });

  it('ignores a move onto a taken name and a move of an unknown object', () => {
    const file = last(
      run([
        'create table public.todos (id int); create table public.tasks (id int); alter table public.todos rename to tasks; alter table if exists public.nowhere rename to other;',
      ]),
    );
    expect(tracked(file.after)).toEqual(['public.todos', 'public.tasks']);
    expect(eventsOf(file, 'moved')).toEqual([]);
  });

  it('moves the policies of a relation created outside the migrations', () => {
    const file = last(
      run([
        'create policy p on public.legacy_table for select using (true); alter table public.legacy_table rename to renamed;',
      ]),
    );
    expect(file.after.policies().map((p) => p.relation.name)).toEqual(['renamed']);
    expect(eventsOf(file, 'moved')).toEqual([]);
  });
});

describe('replay: DROP', () => {
  it('drops lists of relations with their policies and owned sequences', () => {
    const file = last(
      run([
        `create table public.todos (id serial); create table public.messages (id int);
         create policy p on public.todos using (true);
         drop table if exists public.todos, public.messages, public.nowhere cascade;`,
      ]),
    );
    expect(tracked(file.after)).toEqual([]);
    expect(file.after.sequences()).toEqual([]);
    expect(file.after.policies()).toEqual([]);
    expect(file.created).toEqual([]);
    expect(eventsOf(file, 'dropped').map((e) => e.name.name)).toEqual(['todos', 'messages']);
  });

  it('drops views, materialized views and sequences', () => {
    const file = last(
      run([
        `create view public.v as select 1; create materialized view public.mv as select 1;
         create sequence public.s;
         drop view public.v; drop materialized view public.mv; drop sequence public.s, public.missing;`,
      ]),
    );
    expect(tracked(file.after)).toEqual([]);
    expect(file.after.sequences()).toEqual([]);
    expect(eventsOf(file, 'dropped').map((e) => `${e.object}:${e.name.name}`)).toEqual([
      'relation:v',
      'relation:mv',
      'sequence:s',
    ]);
  });

  it('drops the policies of a relation the replay never saw created', () => {
    const file = last(
      run(['create policy p on public.legacy_table using (true); drop table public.legacy_table;']),
    );
    expect(file.after.policies()).toEqual([]);
    expect(eventsOf(file, 'dropped')).toEqual([]);
  });
});

describe('replay: GRANT and REVOKE', () => {
  const base = 'create table public.todos (id int); create table public.messages (id int);';

  it('grants and revokes on named relations, TABLE lists and PUBLIC', () => {
    const file = last(
      run(
        [
          `${base} grant select, insert on table public.todos, messages to authenticated;
           grant select on public.messages to public;
           revoke insert on public.todos from authenticated cascade;`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(held(file.after, 'public.todos', 'authenticated')).toEqual(['select']);
    expect(held(file.after, 'public.messages', 'authenticated')).toEqual(['select', 'insert']);
    expect(held(file.after, 'public.messages', 'anon')).toEqual(['select']);
    expect(file.after.relation(split('public.messages'))?.acl.privileges(PUBLIC)).toEqual([
      'select',
    ]);
  });

  it('changes a relation named twice in one statement once', () => {
    const file = last(
      run([`${base} revoke select on public.todos, todos from anon;`], {
        platformDefaults: 'legacy',
      }),
    );
    expect(held(file.after, 'public.todos', 'anon')).toEqual(
      TABLE_PRIVILEGES.filter((p) => p !== 'select'),
    );
    expect(eventsOf(file, 'grant')[0]?.targets).toHaveLength(1);
  });

  it('accepts WITH GRANT OPTION, GRANTED BY, CASCADE and RESTRICT', () => {
    const file = last(
      run(
        [
          `${base} grant all on public.todos to service_role with grant option granted by postgres;
           revoke delete on public.todos from service_role restrict;`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(held(file.after, 'public.todos', 'service_role')).toEqual(
      TABLE_PRIVILEGES.filter((p) => p !== 'delete'),
    );
  });

  it('counts column grants and marks them column-scoped', () => {
    const file = last(
      run([`${base} grant select (id), update (id) on public.todos to authenticated;`], {
        platformDefaults: 'explicit',
      }),
    );
    const acl = file.after.relation(split('public.todos'))?.acl;
    expect(held(file.after, 'public.todos', 'authenticated')).toEqual(['select', 'update']);
    expect(acl?.columnScoped('authenticated', 'select')).toBe(true);
    expect(eventsOf(file, 'grant')[0]?.targets[0]?.privileges).toEqual([
      { name: 'select', columns: ['id'] },
      { name: 'update', columns: ['id'] },
    ]);
  });

  it('ALL TABLES IN SCHEMA changes existing relations only, including views', () => {
    const file = last(
      run(
        [
          `${base} create view public.v as select 1;
           grant select on all tables in schema public to anon;
           create table public.later (id int);
           revoke select on all tables in schema public, private from anon;
           grant insert on all tables in schema public to anon;`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(held(file.after, 'public.v', 'anon')).toEqual(['insert']);
    expect(held(file.after, 'public.later', 'anon')).toEqual(['insert']);
    expect(eventsOf(file, 'grant').map((e) => e.targets.length)).toEqual([3, 4, 4]);
  });

  it('grants and revokes on sequences, by name, by ALL SEQUENCES and through ON TABLE', () => {
    const file = last(
      run(
        [
          `create table public.todos (id serial); create sequence public.s;
           grant usage, select on sequence public.todos_id_seq, public.s to authenticated;
           revoke select on sequence public.s from authenticated;
           grant update on all sequences in schema public to anon;
           grant select on public.s to service_role;
           grant all on table public.s to anon;`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(heldOnSequence(file.after, 'public.todos_id_seq', 'authenticated')).toEqual([
      'usage',
      'select',
    ]);
    expect(heldOnSequence(file.after, 'public.s', 'authenticated')).toEqual(['usage']);
    expect(heldOnSequence(file.after, 'public.todos_id_seq', 'anon')).toEqual(['update']);
    expect(heldOnSequence(file.after, 'public.s', 'service_role')).toEqual(['select']);
    expect(heldOnSequence(file.after, 'public.s', 'anon')).toEqual(SEQUENCE_PRIVILEGES);
    expect(held(file.after, 'public.todos', 'anon')).toEqual([]);
  });

  it('records privileges that are not valid for the object, and untracked names', () => {
    const file = last(
      run([
        'create sequence public.s; create table public.todos (id int); grant insert on table public.s to anon; grant usage on public.todos to anon; grant select on public.nowhere to anon;',
      ]),
    );
    const skipped = eventsOf(file, 'skipped');
    expect(skipped.map((e) => e.reason)).toEqual(['invalid-privilege', 'invalid-privilege']);
    expect(skipped[0]?.message).toContain('insert on public.s');
    expect(skipped[1]?.message).toContain('usage on public.todos');
    expect(eventsOf(file, 'grant')[2]?.untracked).toEqual([split('public.nowhere')]);
    expect(eventsOf(file, 'grant')[2]?.targets).toEqual([]);
  });

  it('resolves CURRENT_USER to the creator role and SESSION_USER to migrationRole', () => {
    const file = last(
      run(
        [
          `${base} set role admin; grant select on public.todos to current_user, session_user; grant insert on public.todos to current_role;`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(held(file.after, 'public.todos', 'admin')).toEqual(['select', 'insert']);
    expect(held(file.after, 'public.todos', 'postgres')).toEqual(['select']);
  });

  it('takes ALL PRIVILEGES to the full list for the object kind', () => {
    const file = last(
      run(
        ['create table public.todos (id serial); grant all privileges on public.todos to anon;'],
        {
          platformDefaults: 'explicit',
        },
      ),
    );
    expect(held(file.after, 'public.todos', 'anon')).toEqual(privilegesFor('table'));
    expect(heldOnSequence(file.after, 'public.todos_id_seq', 'anon')).toEqual([]);
  });
});

describe('replay: ALTER DEFAULT PRIVILEGES', () => {
  it('uses the current creator role when FOR ROLE is omitted', () => {
    const file = last(
      run(
        [
          `set role admin;
           alter default privileges in schema public grant select on tables to anon;
           create table public.todos (id int);
           reset role;
           create table public.messages (id int);`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(eventsOf(file, 'defaultPrivileges')[0]?.creators).toEqual(['admin']);
    expect(held(file.after, 'public.todos', 'anon')).toEqual(['select']);
    expect(held(file.after, 'public.messages', 'anon')).toEqual([]);
    expect(eventsOf(file, 'created').map((e) => e.creator)).toEqual(['admin', 'postgres']);
  });

  it('applies to every schema when IN SCHEMA is omitted, and to each listed role and schema', () => {
    const file = last(
      run(
        [
          `alter default privileges grant select on tables to anon;
           alter default privileges for role postgres, admin in schema public, private grant insert on tables to anon;
           create table billing.invoices (id int);
           create table private.todos (id int);`,
        ],
        { platformDefaults: 'explicit' },
      ),
    );
    expect(held(file.after, 'billing.invoices', 'anon')).toEqual(['select']);
    expect(held(file.after, 'private.todos', 'anon')).toEqual(['select', 'insert']);
    expect(file.after.defaults.entry('admin', 'private', 'table').holds('anon', 'insert')).toBe(
      true,
    );
    expect(eventsOf(file, 'defaultPrivileges')[1]).toMatchObject({
      creators: ['postgres', 'admin'],
      schemas: ['public', 'private'],
    });
  });

  it('does not change what another creator role gets', () => {
    const file = last(
      run([
        `alter default privileges for role admin in schema public revoke all on tables from anon, authenticated, service_role;
         create table public.todos (id int);`,
      ]),
    );
    expect(held(file.after, 'public.todos', 'anon')).toEqual(TABLE_PRIVILEGES);
  });

  it('keeps default privileges on REVOKE GRANT OPTION FOR, and handles sequences', () => {
    const file = last(
      run([
        `alter default privileges for role postgres in schema public revoke grant option for all on tables from anon;
         alter default privileges for role postgres in schema public revoke usage on sequences from anon;
         create table public.todos (id serial);`,
      ]),
    );
    expect(held(file.after, 'public.todos', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(heldOnSequence(file.after, 'public.todos_id_seq', 'anon')).toEqual(['select', 'update']);
    expect(eventsOf(file, 'defaultPrivileges').map((e) => e.grantOptionOnly)).toEqual([
      true,
      false,
    ]);
  });

  it('records privileges that default privileges cannot hold', () => {
    const file = last(run(['alter default privileges grant usage on tables to anon;']));
    expect(eventsOf(file, 'skipped')).toMatchObject([
      { reason: 'invalid-privilege', message: expect.stringContaining('on tables') as string },
    ]);
    const sequences = last(run(['alter default privileges grant insert on sequences to anon;']));
    expect(eventsOf(sequences, 'skipped')[0]?.message).toContain('on sequences');
  });

  it('shows the effect only on relations created after it', () => {
    const result = run([
      'create table public.todos (id int);',
      OPT_IN,
      'create table public.messages (id int);',
    ]);
    const final = result.final;
    expect(held(final, 'public.todos', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(held(final, 'public.messages', 'anon')).toEqual([]);
  });
});

describe('replay: policies', () => {
  const base = 'create table public.todos (id int);';

  it('ALTER POLICY changes the roles and marks the policy altered in that file', () => {
    const result = run([
      `${base} create policy p on public.todos for update to authenticated using (true);`,
      'alter policy p on public.todos to anon, authenticated;',
      'alter policy p on public.todos using (false);',
    ]);
    const [first, second, third] = result.files;
    expect(first?.policies).toMatchObject([{ roles: ['authenticated'], altered: null }]);
    expect(second?.policies).toMatchObject([
      { roles: ['anon', 'authenticated'], command: 'update', altered: { file: path(2) } },
    ]);
    expect(third?.policies).toMatchObject([
      { roles: ['anon', 'authenticated'], altered: { file: path(3) } },
    ]);
    expect(eventsOf(third as FileReplay, 'policy')).toMatchObject([
      { action: 'alter', known: true, command: 'update', roles: ['anon', 'authenticated'] },
    ]);
  });

  it('records ALTER, RENAME and DROP of a policy it never saw created as unknown', () => {
    const file = last(
      run([
        `${base} alter policy p on public.todos to anon; alter policy p on public.todos using (true); alter policy p on public.todos rename to q; drop policy if exists p on public.todos;`,
      ]),
    );
    expect(file.after.policies()).toEqual([]);
    expect(file.policies).toEqual([]);
    expect(eventsOf(file, 'policy')).toMatchObject([
      { action: 'alter', known: false, command: null, roles: ['anon'] },
      { action: 'alter', known: false, command: null, roles: null },
      { action: 'rename', known: false, newName: 'q' },
      { action: 'drop', known: false },
    ]);
  });

  it('renames and drops policies', () => {
    const file = last(
      run([
        `${base} create policy p on public.todos for select using (true);
         create policy r on public.todos for insert with check (true);
         alter policy p on public.todos rename to q;
         alter policy r on public.todos rename to q;
         drop policy r on public.todos;`,
      ]),
    );
    expect(
      file.after.policiesOn(split('public.todos')).map((p) => `${p.name}:${p.command}`),
    ).toEqual(['q:select']);
    expect(eventsOf(file, 'policy').map((e) => `${e.action}:${String(e.known)}`)).toEqual([
      'create:true',
      'create:true',
      'rename:true',
      'rename:true',
      'drop:true',
    ]);
  });

  it('CREATE POLICY resolves roles and replaces a same-named policy', () => {
    const file = last(
      run([
        `${base} set role admin;
         create policy p on todos for select to current_user, public using (true);
         create policy p on todos for delete to anon using (true);`,
      ]),
    );
    expect(file.after.policiesOn(split('public.todos'))).toMatchObject([
      { name: 'p', command: 'delete', roles: ['anon'] },
    ]);
    expect(eventsOf(file, 'policy')[0]?.roles).toEqual(['admin', PUBLIC]);
  });
});

describe('replay: SET ROLE', () => {
  it('changes the creator for the rest of the file only', () => {
    const result = run(
      [
        `alter default privileges for role admin in schema public grant select on tables to anon;
         set local role admin; create table public.todos (id int);`,
        'create table public.messages (id int);',
      ],
      { platformDefaults: 'explicit' },
    );
    const [first, second] = result.files;
    expect(first && held(first.after, 'public.todos', 'anon')).toEqual(['select']);
    expect(second && held(second.after, 'public.messages', 'anon')).toEqual([]);
    expect(eventsOf(first as FileReplay, 'creator')).toMatchObject([{ role: 'admin' }]);
  });

  it('returns to migrationRole on RESET ROLE and SET ROLE NONE', () => {
    const file = last(
      run(['set role admin; reset role; set role admin; set role none;'], {
        migrationRole: 'deployer',
      }),
    );
    expect(eventsOf(file, 'creator').map((e) => e.role)).toEqual([
      'admin',
      'deployer',
      'admin',
      'deployer',
    ]);
  });
});

describe('replay: statements it cannot model', () => {
  it('records DO blocks that mention grants and ignores the others', () => {
    const file = last(
      run([
        `do $$ begin execute 'grant select on public.todos to anon'; end $$;
         do $$ begin raise notice 'hello'; end $$;`,
      ]),
    );
    expect(eventsOf(file, 'skipped')).toMatchObject([
      {
        reason: 'dynamic-sql',
        at: { line: 1, column: 1 },
        message: expect.stringContaining('grant') as string,
      },
    ]);
  });

  it('records unparseable statements and keeps replaying', () => {
    const file = last(
      run([
        'create table public.todos (id int);\ncreate tabel oops;\ncreate table public.messages (id int);',
      ]),
    );
    expect(eventsOf(file, 'skipped')).toMatchObject([{ reason: 'unparseable', at: { line: 2 } }]);
    expect(tracked(file.after)).toEqual(['public.todos', 'public.messages']);
  });

  it('ignores statements the model does not need', () => {
    const file = last(
      run(['select 1; create function f() returns int language sql as $$ select 1 $$;']),
    );
    expect(file.events).toEqual([]);
    expect(file.after).toBe(file.before);
  });
});

describe('replay: snapshots and sequences over several files', () => {
  it('keeps each end-of-file snapshot unchanged by later files', () => {
    const result = run([
      'create table public.todos (id int);',
      'revoke all on public.todos from anon; drop table public.todos;',
    ]);
    const [first, second] = result.files;
    expect(first && held(first.after, 'public.todos', 'anon')).toEqual(TABLE_PRIVILEGES);
    expect(second?.before).toBe(first?.after);
    expect(second?.after.relation(split('public.todos'))).toBeUndefined();
    expect(result.files.map((f) => [f.index, f.version])).toEqual([
      [0, version(1)],
      [1, version(2)],
    ]);
    expect(result.final).toBe(second?.after);
  });

  it('follows a serial sequence through create, grant, rename, drop and re-create', () => {
    const result = run(
      [
        `create table public.todos (id bigserial);
         grant usage on sequence public.todos_id_seq to authenticated;`,
        'alter table public.todos rename to tasks;',
        'grant select on sequence public.todos_id_seq to anon;',
        'drop table public.tasks;',
        'create table public.todos (id bigserial);',
      ],
      { platformDefaults: 'explicit' },
    );
    const [created, renamed, granted, dropped, recreated] = result.files;
    expect(
      created && heldOnSequence(created.after, 'public.todos_id_seq', 'authenticated'),
    ).toEqual(['usage']);
    expect(renamed?.after.sequence(split('public.todos_id_seq'))?.ownedBy).toEqual({
      relation: split('public.tasks'),
      column: 'id',
    });
    expect(granted && heldOnSequence(granted.after, 'public.todos_id_seq', 'anon')).toEqual([
      'select',
    ]);
    expect(dropped?.after.sequences()).toEqual([]);
    expect(recreated && heldOnSequence(recreated.after, 'public.todos_id_seq', 'anon')).toEqual([]);
    expect(recreated?.after.sequence(split('public.todos_id_seq'))?.created?.file).toBe(path(5));
  });

  it('limits created relations and policies to the configured schemas', () => {
    const result = run(
      [
        `create table public.todos (id int); create table api.todos (id int);
         create policy p on public.todos using (true); create policy p on api.todos using (true);`,
      ],
      { schemas: ['api'] },
    );
    const file = last(result);
    expect(createdIn(file)).toEqual(['api.todos']);
    expect(file.policies.map((p) => p.relation.schema)).toEqual(['api']);
    expect(result.inScope(split('public.todos'))).toBe(false);
  });
});
