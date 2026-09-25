import { scanSync } from 'libpg-query';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  grantSql,
  quoteIdent,
  RESERVED_KEYWORDS,
  revokeSql,
  sqlGrantee,
  sqlRelation,
} from '../../src/fix/sql.js';
import { PUBLIC } from '../../src/model/acl.js';
import { loadParser, type MigrationParser } from '../../src/parse/adapter.js';
import type { Grant } from '../../src/parse/ir.js';

let parser: MigrationParser;

beforeAll(async () => {
  parser = await loadParser();
});

/** The parser's keyword kind: 0 not a keyword, 1 unreserved, 2 column name, 3 type or function name, 4 reserved. */
function keywordKind(word: string): number | undefined {
  return scanSync(word).tokens[0]?.keywordKind;
}

function onlyGrant(sql: string): Grant {
  const [stmt, ...rest] = parser.parse(sql, 'fix.sql').statements;
  expect(rest).toEqual([]);
  if (stmt?.kind !== 'Grant') throw new Error(`not a grant: ${sql} -> ${JSON.stringify(stmt)}`);
  return stmt;
}

describe('quoteIdent', () => {
  it('leaves ordinary lowercase names bare', () => {
    for (const name of [
      'todos',
      'audit_log',
      '_x',
      'a1',
      'price$',
      'service_role',
      'public',
      'between',
      'none',
      'abort',
    ]) {
      expect(quoteIdent(name)).toBe(name);
    }
  });

  it('quotes names Postgres would fold or reject', () => {
    expect(quoteIdent('Todos')).toBe('"Todos"');
    expect(quoteIdent('my table')).toBe('"my table"');
    expect(quoteIdent('1st')).toBe('"1st"');
    expect(quoteIdent('a-b')).toBe('"a-b"');
    expect(quoteIdent('say "hi"')).toBe('"say ""hi"""');
    expect(quoteIdent('')).toBe('""');
    expect(quoteIdent('ümlaut')).toBe('"ümlaut"');
    expect(quoteIdent('user')).toBe('"user"');
    expect(quoteIdent('order')).toBe('"order"');
    expect(quoteIdent('left')).toBe('"left"');
  });

  it('quotes exactly the keywords the parser treats as reserved', () => {
    for (const word of RESERVED_KEYWORDS) {
      expect([word, keywordKind(word)]).toEqual([word, expect.toBeOneOf([3, 4])]);
    }
    for (const word of [
      'between',
      'none',
      'abort',
      'grant_option',
      'public',
      'todos',
      'values',
      'setof',
    ]) {
      expect([word, keywordKind(word)]).toEqual([word, expect.toBeOneOf([0, 1, 2])]);
    }
  });
});

describe('fix SQL', () => {
  it('renders relations, grantees and statements', () => {
    expect(sqlRelation({ schema: 'public', name: 'todos' })).toBe('public.todos');
    expect(sqlRelation({ schema: 'My Schema', name: 'order' })).toBe('"My Schema"."order"');
    expect(sqlGrantee(PUBLIC)).toBe('public');
    expect(sqlGrantee('Admin')).toBe('"Admin"');
    expect(
      grantSql({
        privileges: ['select', 'insert', 'update', 'delete'],
        relation: { schema: 'public', name: 'todos' },
        grantees: ['service_role'],
      }),
    ).toBe('grant select, insert, update, delete on public.todos to service_role;');
    expect(
      grantSql({
        privileges: ['usage'],
        relation: { schema: 'public', name: 'orders_id_seq' },
        sequence: true,
        grantees: ['anon', 'authenticated'],
      }),
    ).toBe('grant usage on sequence public.orders_id_seq to anon, authenticated;');
    expect(
      revokeSql({
        privileges: ['truncate', 'references', 'trigger'],
        relation: { schema: 'public', name: 'todos' },
        grantees: ['anon', PUBLIC],
      }),
    ).toBe('revoke truncate, references, trigger on public.todos from anon, public;');
  });

  it('parses back to the same objects, privileges and roles', () => {
    const cases = [
      { relation: { schema: 'public', name: 'todos' }, grantees: ['anon'] as const },
      { relation: { schema: 'public', name: 'user' }, grantees: ['user'] as const },
      { relation: { schema: 'Api', name: 'Mixed Case' }, grantees: ['Role "x"'] as const },
      {
        relation: { schema: 'left', name: 'select' },
        grantees: ['authorization', 'none_role'] as const,
      },
    ];
    for (const { relation, grantees } of cases) {
      for (const build of [grantSql, revokeSql]) {
        const sql = build({
          privileges: ['select', 'maintain'],
          relation,
          grantees: [...grantees],
        });
        const stmt = onlyGrant(sql);
        expect(stmt.target).toEqual({
          kind: 'objects',
          objects: [{ schema: relation.schema, name: relation.name }],
        });
        expect(stmt.privileges.map((p) => p.name)).toEqual(['select', 'maintain']);
        expect(stmt.grantees).toEqual(grantees.map((name) => ({ kind: 'role', name })));
      }
    }
    const pub = onlyGrant(
      grantSql({
        privileges: ['usage'],
        relation: { schema: 'public', name: 's' },
        sequence: true,
        grantees: [PUBLIC],
      }),
    );
    expect(pub.objectKind).toBe('sequence');
    expect(pub.grantees).toEqual([{ kind: 'public' }]);
  });
});
