import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { colors } from '../../src/cli/color.js';
import { ExitCode } from '../../src/cli/exit-codes.js';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import { COMMAND_USAGE } from '../../src/cli/usage.js';
import { explain, formatExplain, parseRelationName } from '../../src/explain.js';

const temp = mkdtempSync(path.join(tmpdir(), 'grants-lint-explain-'));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** A project whose migrations are `files`, in order (named `2026100100000<i>_<i>.sql`). */
function project(name: string, files: readonly string[]): string {
  const dir = path.join(temp, name, 'supabase', 'migrations');
  mkdirSync(dir, { recursive: true });
  files.forEach((text, i) => {
    writeFileSync(path.join(dir, `2026100100000${String(i)}_m${String(i)}.sql`), text);
  });
  return path.join(temp, name);
}

function fakeIo(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd,
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const texts = async (cwd: string, relation: string) =>
  (await explain({ cwd, relation })).timeline.map((e) => `${e.action} ${e.text}`);

describe('parseRelationName', () => {
  it.each([
    ['public.todos', { schema: 'public', name: 'todos' }],
    ['todos', { schema: 'public', name: 'todos' }],
    ['  Api.Todos ', { schema: 'api', name: 'todos' }],
    ['"My Table"', { schema: 'public', name: 'My Table' }],
    ['api."Or""ders"', { schema: 'api', name: 'Or"ders' }],
    ['"a.b".c', { schema: 'a.b', name: 'c' }],
  ])('reads %j like SQL', (input, expected) => {
    expect(parseRelationName(input)).toEqual(expected);
  });

  it.each(['', 'a.b.c', '.todos', 'public.', 'my table', '""'])('rejects %j', (input) => {
    expect(() => parseRelationName(input)).toThrow(
      `explain expects <schema.relation> (for example public.todos), got "${input}".`,
    );
  });
});

describe('explain', () => {
  it('shows each relation that carried a name dropped and created again', async () => {
    const cwd = project('recreated', [
      'create table public.todos (id uuid primary key);\n',
      'drop table public.todos;\ncreate view public.todos as select 1 as id;\n',
    ]);
    const result = await explain({ cwd, relation: 'public.todos' });
    expect(result.timeline.map((e) => e.action)).toEqual(['create', 'drop', 'create']);
    expect(result.final.map((f) => [f.relation, f.kind])).toEqual([['public.todos', 'view']]);
    expect(result.names).toEqual(['public.todos']);
  });

  it('says when the relation no longer exists', async () => {
    const cwd = project('dropped', [
      'create table public.todos (id uuid primary key);\ndrop table public.todos;\n',
    ]);
    const result = await explain({ cwd, relation: 'public.todos' });
    expect(result.final).toEqual([]);
    expect(formatExplain(result)).toContain(
      'public.todos does not exist after the last migration.',
    );
  });

  it('follows SET SCHEMA as a move, under either name', async () => {
    const cwd = project('moved', [
      'create table public.todos (id uuid primary key);\nalter table public.todos set schema api;\n',
    ]);
    expect(await texts(cwd, 'api.todos')).toEqual([
      'create table public.todos by postgres; default privileges give all to anon, authenticated, service_role',
      'move public.todos to api.todos',
    ]);
    const result = await explain({ cwd, relation: 'public.todos' });
    expect(result.final.map((f) => f.relation)).toEqual(['api.todos']);
  });

  it('shows the old relation and the new one when a rename frees a name that is reused', async () => {
    const cwd = project('reused', [
      'create table public.todos (id uuid primary key);\nalter table public.todos rename to tasks;\n' +
        'create table public.todos (id uuid primary key);\n',
    ]);
    const result = await explain({ cwd, relation: 'public.todos' });
    expect(result.timeline.map((e) => `${String(e.at.line)} ${e.action}`)).toEqual([
      '1 create',
      '2 rename',
      '3 create',
    ]);
    expect(result.final.map((f) => f.relation)).toEqual(['public.tasks', 'public.todos']);
    expect(result.names).toEqual(['public.todos', 'public.tasks']);
  });

  it('explains a relation the migrations never create from its grants and policies', async () => {
    const cwd = project('untracked', [
      'grant select on public.messages to anon;\n' +
        'create policy "read" on public.messages for select using (true);\n' +
        'alter policy "read" on public.messages to anon, authenticated;\n' +
        'drop policy "read" on public.messages;\n',
    ]);
    const result = await explain({ cwd, relation: 'public.messages' });
    expect(result.createdByMigrations).toBe(false);
    expect(result.final).toEqual([]);
    expect(result.timeline.map((e) => `${e.action} ${e.text}`)).toEqual([
      'grant select on public.messages to anon',
      'policy create "read" for select to public',
      'policy alter "read"',
      'policy drop "read"',
    ]);
    expect(formatExplain(result)).toContain(
      'No migration creates public.messages, so its privileges come from outside the migrations ' +
        'and are not known.',
    );
  });

  it('describes grant options, column grants, SET ROLE and other grantees', async () => {
    const cwd = project('details', [
      'set role admin;\ncreate table public.todos (id uuid primary key, title text);\nreset role;\n' +
        'grant select, update (title) on public.todos to authenticated with grant option;\n' +
        'revoke grant option for select on public.todos from authenticated;\n' +
        'grant select on public.todos to public;\n' +
        'grant insert on public.todos to reporting;\n' +
        'grant usage on sequence public.other_seq to anon;\n',
    ]);
    expect(await texts(cwd, 'public.todos')).toEqual([
      'create table public.todos by admin; no default privileges',
      'grant select, update (title) on public.todos to authenticated',
      'revoke grant option for select on public.todos from authenticated',
      'grant select on public.todos to public',
      'grant insert on public.todos to reporting',
    ]);
    const [final] = (await explain({ cwd, relation: 'public.todos' })).final;
    expect(final?.roles).toEqual([
      { role: 'anon', privileges: ['select'] },
      { role: 'authenticated', privileges: ['select', 'update (columns)'] },
      { role: 'service_role', privileges: ['select'] },
      { role: 'reporting', privileges: ['select', 'insert'] },
      { role: 'PUBLIC', privileges: ['select'] },
    ]);
  });

  it('groups default privileges that differ per role', async () => {
    const cwd = project('partial-defaults', [
      'alter default privileges in schema public revoke insert, update, delete, truncate, ' +
        'references, trigger, maintain on tables from anon;\n' +
        'alter default privileges in schema public revoke all on tables from service_role;\n' +
        'create table public.todos (id uuid primary key);\n',
    ]);
    expect((await texts(cwd, 'todos'))[0]).toBe(
      'create table public.todos by postgres; default privileges give select to anon; ' +
        'all to authenticated',
    );
  });

  it('names every schema of ON ALL TABLES IN SCHEMA', async () => {
    const cwd = project('all-tables', [
      'create table public.todos (id uuid primary key);\n' +
        'revoke all on all tables in schema public, api from anon;\n',
    ]);
    expect((await texts(cwd, 'public.todos'))[1]).toBe(
      'revoke all on all tables in schema public, api from anon',
    );
  });

  it('rejects an unknown relation with the closest names, or says there are none', async () => {
    const cwd = project('unknown', [
      'create table public.orders (id uuid primary key);\n' +
        'create table public.todos (id uuid primary key);\n' +
        'create table public.audit_log (id uuid primary key);\n' +
        'create table public.messages (id uuid primary key);\n',
    ]);
    await expect(explain({ cwd, relation: 'public.todo' })).rejects.toThrow(
      'No migration creates, grants on or adds a policy to public.todo. ' +
        'Closest matches: public.todos, public.orders, public.audit_log.',
    );
    await expect(explain({ cwd: project('empty', []), relation: 'public.todos' })).rejects.toThrow(
      'The migrations mention no relations.',
    );
  });

  it('prints bold headings when colour is on', async () => {
    const cwd = project('colour', ['create table public.todos (id uuid primary key);\n']);
    const text = formatExplain(await explain({ cwd, relation: 'todos' }), colors(true));
    expect(text).toContain('\u001b[1mpublic.todos: grant timeline\u001b[22m');
    expect(text).toContain('\u001b[1mPolicies on public.todos\u001b[22m\n  none');
  });
});

describe('explain command', () => {
  const cwd = project('cli', ['create table public.todos (id uuid primary key);\n']);

  it('prints the explanation with exit 0', async () => {
    const { io, stdout } = fakeIo(cwd);
    expect(await run(['explain', 'public.todos', '--no-color'], io)).toBe(ExitCode.Ok);
    expect(stdout()).toBe(formatExplain(await explain({ cwd, relation: 'public.todos' })));
  });

  it('prints its help', async () => {
    const { io, stdout } = fakeIo(cwd);
    expect(await run(['explain', '--help'], io)).toBe(ExitCode.Ok);
    expect(stdout()).toBe(COMMAND_USAGE.explain);
  });

  it.each([
    [[], 'explain needs a relation, e.g. supabase-grants-lint explain public.todos.'],
    [
      ['public.todos', 'public.orders'],
      'explain takes one relation, got "public.todos public.orders".',
    ],
    [
      ['public.todos', '--sinse', 'none'],
      'Unknown option --sinse for explain. Did you mean "--since"?',
    ],
    [['a.b.c'], 'explain expects <schema.relation>'],
    [['public.nope'], 'No migration creates, grants on or adds a policy to public.nope.'],
    [['public.todos', '--dir', 'missing'], 'missing'],
  ])('exits 2 for %j', async (args, message) => {
    const { io, stderr } = fakeIo(cwd);
    expect(await run(['explain', ...args], io)).toBe(ExitCode.Usage);
    expect(stderr()).toContain(message);
  });

  it('passes --dir, --config, --since and --schema on', async () => {
    const { io, stdout } = fakeIo(temp);
    writeFileSync(path.join(cwd, 'other.json'), '{"schemas": ["public"]}\n');
    const args = [
      '--dir',
      'cli',
      '--config',
      'cli/other.json',
      '--since',
      'none',
      '--schema',
      'public',
    ];
    expect(await run(['explain', 'public.todos', ...args], io)).toBe(ExitCode.Ok);
    expect(stdout()).toContain('supabase/migrations/20261001000000_m0.sql');
  });
});
