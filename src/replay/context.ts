/**
 * State shared by the replay handlers while one file is replayed, and the events they record.
 *
 * The catalog tracks non-temporary relations and sequences in every schema, so that `SET SCHEMA`
 * into a configured schema carries the real ACL (spec §6.1). Which schemas are in scope is a
 * question for the rules: they read `ReplayResult.inScope`, and `FileReplay.created` and
 * `FileReplay.policies` are already limited to the configured schemas.
 */
import type {
  PolicyCommand,
  Privilege,
  QualifiedName,
  RelationKind,
  RoleRef,
  SourceLocation,
} from '../parse/ir.js';
import type { Acl, AclKind, GrantedPrivilege, Grantee } from '../model/acl.js';
import { PUBLIC } from '../model/acl.js';
import type { Catalog, RelationName } from '../model/relations.js';

/** Where an unqualified name resolves: the first schema of Postgres' default `search_path`. */
export const DEFAULT_SCHEMA = 'public';

export interface ReplayOptions {
  /** Schemas whose relations the rules check (config `schemas`). */
  readonly schemas: readonly string[];
  /** The role migrations run as (config `migrationRole`); `SET ROLE` changes it within a file. */
  readonly migrationRole: string;
}

/** A relation or sequence came into existence. */
export interface CreatedEvent {
  readonly kind: 'created';
  readonly at: SourceLocation;
  readonly object: 'relation' | 'sequence';
  readonly name: RelationName;
  /** For relations; `null` for sequences. */
  readonly relationKind: RelationKind | null;
  /** The role whose default privileges it received. */
  readonly creator: string;
  /** The privileges it received from those defaults. */
  readonly acl: Acl;
  /** For sequences created by a serial column. */
  readonly ownedBy: { readonly relation: RelationName; readonly column: string } | null;
}

export interface DroppedEvent {
  readonly kind: 'dropped';
  readonly at: SourceLocation;
  readonly object: 'relation' | 'sequence';
  readonly name: RelationName;
}

/** `RENAME TO` or `SET SCHEMA`. */
export interface MovedEvent {
  readonly kind: 'moved';
  readonly at: SourceLocation;
  readonly object: 'relation' | 'sequence';
  readonly from: RelationName;
  readonly to: RelationName;
}

/** A `GRANT` or `REVOKE` on relations or sequences, after names and roles are resolved. */
export interface GrantEvent {
  readonly kind: 'grant';
  readonly at: SourceLocation;
  readonly action: 'grant' | 'revoke';
  /** `table` for `ON [TABLE]` and `ALL TABLES`, `sequence` for `ON SEQUENCE` and `ALL SEQUENCES`. */
  readonly objectKind: AclKind;
  /** The privileges as written (`all` unexpanded, column lists kept), for fix text. */
  readonly written: readonly Privilege[];
  /** `ON ALL TABLES | ALL SEQUENCES IN SCHEMA`: the schemas; `null` for named objects. */
  readonly allInSchemas: readonly string[] | null;
  readonly grantees: readonly Grantee[];
  /** `REVOKE GRANT OPTION FOR`: the privileges themselves are kept. */
  readonly grantOptionOnly: boolean;
  /** Every tracked object the statement changed, with the privileges as recorded. */
  readonly targets: readonly GrantTarget[];
  /** Named objects the catalog does not track (created outside the migrations, or dropped). */
  readonly untracked: readonly RelationName[];
}

export interface GrantTarget {
  readonly object: AclKind;
  readonly name: RelationName;
  readonly privileges: readonly GrantedPrivilege[];
}

/** `ALTER DEFAULT PRIVILEGES` on tables or sequences, after roles are resolved. */
export interface DefaultPrivilegesEvent {
  readonly kind: 'defaultPrivileges';
  readonly at: SourceLocation;
  readonly action: 'grant' | 'revoke';
  /** `FOR ROLE`, or the current creator role when omitted. */
  readonly creators: readonly string[];
  /** `IN SCHEMA`, or `[null]` (all schemas) when omitted. */
  readonly schemas: readonly (string | null)[];
  readonly object: AclKind;
  readonly grantees: readonly Grantee[];
  readonly privileges: readonly string[];
  readonly grantOptionOnly: boolean;
}

export interface PolicyEvent {
  readonly kind: 'policy';
  readonly at: SourceLocation;
  readonly action: 'create' | 'alter' | 'rename' | 'drop';
  readonly relation: RelationName;
  readonly name: string;
  /** The policy's name after a rename, otherwise equal to `name`. */
  readonly newName: string;
  /** False when the policy is not in the catalog (altered or dropped without being seen created). */
  readonly known: boolean;
  /** For `create`: the command and roles; `null` otherwise. */
  readonly command: PolicyCommand | null;
  readonly roles: readonly Grantee[] | null;
}

/** `SET ROLE` / `RESET ROLE`: the creator role for the rest of the file. */
export interface CreatorEvent {
  readonly kind: 'creator';
  readonly at: SourceLocation;
  readonly role: string;
}

/** Something the replay could not model or had to skip; rules turn these into notices. */
export interface SkippedEvent {
  readonly kind: 'skipped';
  readonly at: SourceLocation;
  readonly reason: 'dynamic-sql' | 'unparseable' | 'invalid-privilege';
  readonly message: string;
}

/**
 * The announced platform revoke, assumed before the first enforced file when `since` is set
 * explicitly (ADR-002 item 1). Located at the start of that file; rules report it as a notice.
 */
export interface PlatformRevokeEvent {
  readonly kind: 'platformRevoke';
  readonly at: SourceLocation;
  readonly creator: string;
  readonly schema: string;
  /** The default privileges it removed, per object kind and grantee. */
  readonly removed: readonly {
    readonly object: AclKind;
    readonly grantee: string;
    readonly privileges: readonly string[];
  }[];
}

export type ReplayEvent =
  | CreatedEvent
  | DroppedEvent
  | MovedEvent
  | GrantEvent
  | DefaultPrivilegesEvent
  | PolicyEvent
  | CreatorEvent
  | SkippedEvent
  | PlatformRevokeEvent;

/** Mutable state of one file's replay. Handlers replace `catalog`; it is immutable itself. */
export interface ReplayContext {
  readonly options: ReplayOptions;
  catalog: Catalog;
  /** The role creating objects: `migrationRole` at the start of every file. */
  creator: string;
  readonly events: ReplayEvent[];
}

export function resolveName({ schema, name }: QualifiedName): RelationName {
  return { schema: schema ?? DEFAULT_SCHEMA, name };
}

/**
 * The grantee a role reference stands for. `CURRENT_USER` and `CURRENT_ROLE` follow `SET ROLE`;
 * `SESSION_USER` is the role the migration connected as.
 */
export function resolveRole(role: RoleRef, ctx: ReplayContext): Grantee {
  switch (role.kind) {
    case 'public':
      return PUBLIC;
    case 'role':
      return role.name;
    case 'current_user':
    case 'current_role':
      return ctx.creator;
    case 'session_user':
      return ctx.options.migrationRole;
  }
}

export function resolveRoles(roles: readonly RoleRef[], ctx: ReplayContext): Grantee[] {
  return [...new Set(roles.map((r) => resolveRole(r, ctx)))];
}

/** A statement's location without its other fields, for events and the catalog. */
export function locate({ file, line, column }: SourceLocation): SourceLocation {
  return { file, line, column };
}

export function qualified({ schema, name }: RelationName): string {
  return `${schema}.${name}`;
}
