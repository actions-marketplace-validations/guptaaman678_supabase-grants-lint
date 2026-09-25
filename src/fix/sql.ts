/**
 * SQL for the `fix` text of findings. Identifiers are quoted only when Postgres needs it, so the
 * usual fix reads the way people write migrations: `grant select on public.todos to anon;`.
 */
import { type Grantee, PUBLIC } from '../model/acl.js';
import type { RelationName } from '../model/relations.js';

/**
 * Keywords that cannot be a bare schema, table or role name: Postgres' `reserved` and
 * `reserved (can be function or type)` categories (parser keyword kinds 4 and 3; a unit test checks
 * every entry against the parser). Other keywords (`between`, `none`, `abort`) are valid names.
 */
const RESERVED = new Set([
  // reserved
  'all',
  'analyse',
  'analyze',
  'and',
  'any',
  'array',
  'as',
  'asc',
  'asymmetric',
  'both',
  'case',
  'cast',
  'check',
  'collate',
  'column',
  'constraint',
  'create',
  'current_catalog',
  'current_date',
  'current_role',
  'current_time',
  'current_timestamp',
  'current_user',
  'default',
  'deferrable',
  'desc',
  'distinct',
  'do',
  'else',
  'end',
  'except',
  'false',
  'fetch',
  'for',
  'foreign',
  'from',
  'grant',
  'group',
  'having',
  'in',
  'initially',
  'intersect',
  'into',
  'lateral',
  'leading',
  'limit',
  'localtime',
  'localtimestamp',
  'not',
  'null',
  'offset',
  'on',
  'only',
  'or',
  'order',
  'placing',
  'primary',
  'references',
  'returning',
  'select',
  'session_user',
  'some',
  'symmetric',
  'system_user',
  'table',
  'then',
  'to',
  'trailing',
  'true',
  'union',
  'unique',
  'user',
  'using',
  'variadic',
  'when',
  'where',
  'window',
  'with',
  // reserved (can be function or type)
  'authorization',
  'binary',
  'collation',
  'concurrently',
  'cross',
  'current_schema',
  'freeze',
  'full',
  'ilike',
  'inner',
  'is',
  'isnull',
  'join',
  'left',
  'like',
  'natural',
  'notnull',
  'outer',
  'overlaps',
  'right',
  'similar',
  'tablesample',
  'verbose',
]);

/** The reserved keywords `quoteIdent` quotes, for tests. */
export const RESERVED_KEYWORDS: readonly string[] = [...RESERVED];

const BARE = /^[a-z_][a-z0-9_$]*$/;

/** An identifier as Postgres reads it back unchanged: bare when possible, otherwise quoted. */
export function quoteIdent(name: string): string {
  if (BARE.test(name) && !RESERVED.has(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

/** `schema.name`, each part quoted only when needed. */
export function sqlRelation({ schema, name }: RelationName): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`;
}

/** A grantee in GRANT and REVOKE: the `PUBLIC` group is the keyword, roles are identifiers. */
export function sqlGrantee(grantee: Grantee): string {
  return grantee === PUBLIC ? 'public' : quoteIdent(grantee);
}

export interface PrivilegeStatement {
  readonly privileges: readonly string[];
  readonly relation: RelationName;
  /** `true` for `ON SEQUENCE`; relations need no object keyword. */
  readonly sequence?: boolean;
  readonly grantees: readonly Grantee[];
}

function target(statement: PrivilegeStatement): string {
  const on = statement.sequence === true ? 'sequence ' : '';
  return `${statement.privileges.join(', ')} on ${on}${sqlRelation(statement.relation)}`;
}

function granteeList(grantees: readonly Grantee[]): string {
  return grantees.map(sqlGrantee).join(', ');
}

/** `grant select, insert on public.todos to anon, authenticated;` */
export function grantSql(statement: PrivilegeStatement): string {
  return `grant ${target(statement)} to ${granteeList(statement.grantees)};`;
}

/** `revoke truncate, references on public.todos from anon;` */
export function revokeSql(statement: PrivilegeStatement): string {
  return `revoke ${target(statement)} from ${granteeList(statement.grantees)};`;
}
