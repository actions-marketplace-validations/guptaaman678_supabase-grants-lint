/**
 * Default privileges (`ALTER DEFAULT PRIVILEGES`), keyed by creator role, schema (or all schemas)
 * and object kind (spec §6.1). They are applied to a relation only when it is created.
 */
import type { PlatformDefaults } from '../config/defaults.js';
import { Acl, type AclKind, type Grantee, privilegesFor } from './acl.js';

/**
 * What the platform did before the change: `postgres` creating in `public` gave `anon`,
 * `authenticated` and `service_role` every privilege on new tables and sequences.
 */
export const LEGACY_DEFAULTS = {
  creator: 'postgres',
  schema: 'public',
  grantees: ['anon', 'authenticated', 'service_role'],
} as const;

export interface DefaultPrivilegeEntry {
  readonly creator: string;
  /** `null` for defaults without `IN SCHEMA`, which apply in every schema. */
  readonly schema: string | null;
  readonly kind: AclKind;
  readonly acl: Acl;
}

function key(creator: string, schema: string | null, kind: AclKind): string {
  return JSON.stringify([creator, schema, kind]);
}

/** Immutable: every change returns a new map. */
export class DefaultPrivileges {
  static readonly EMPTY = new DefaultPrivileges(new Map());

  readonly #entries: ReadonlyMap<string, DefaultPrivilegeEntry>;

  private constructor(entries: ReadonlyMap<string, DefaultPrivilegeEntry>) {
    this.#entries = entries;
  }

  /** The state before the first migration, from config `platformDefaults`. */
  static initial(platformDefaults: PlatformDefaults): DefaultPrivileges {
    if (platformDefaults === 'explicit') return DefaultPrivileges.EMPTY;
    const { creator, schema, grantees } = LEGACY_DEFAULTS;
    return DefaultPrivileges.EMPTY.grant(
      creator,
      schema,
      'table',
      grantees,
      privilegesFor('table'),
    ).grant(creator, schema, 'sequence', grantees, privilegesFor('sequence'));
  }

  /** `privileges` are expanded names (see `expandPrivileges`); default privileges have no columns. */
  grant(
    creator: string,
    schema: string | null,
    kind: AclKind,
    grantees: readonly Grantee[],
    privileges: readonly string[],
  ): DefaultPrivileges {
    return this.#update(creator, schema, kind, (acl) => acl.grant(grantees, privileges));
  }

  revoke(
    creator: string,
    schema: string | null,
    kind: AclKind,
    grantees: readonly Grantee[],
    privileges: readonly string[],
  ): DefaultPrivileges {
    return this.#update(creator, schema, kind, (acl) => acl.revoke(grantees, privileges));
  }

  /** The entry for exactly this creator, schema (or `null`) and kind; empty if none was set. */
  entry(creator: string, schema: string | null, kind: AclKind): Acl {
    return this.#entries.get(key(creator, schema, kind))?.acl ?? Acl.EMPTY;
  }

  /**
   * What a new object of `kind` created by `creator` in `schema` receives. Like Postgres, the
   * schema's entry is added to the all-schemas entry: a per-schema revoke cannot remove a grant
   * made for all schemas.
   */
  effective(creator: string, schema: string, kind: AclKind): Acl {
    return this.entry(creator, null, kind).union(this.entry(creator, schema, kind));
  }

  /** Every non-empty entry, oldest first (an entry emptied and set again counts as new). */
  entries(): readonly DefaultPrivilegeEntry[] {
    return [...this.#entries.values()];
  }

  #update(
    creator: string,
    schema: string | null,
    kind: AclKind,
    change: (acl: Acl) => Acl,
  ): DefaultPrivileges {
    const k = key(creator, schema, kind);
    const acl = change(this.entry(creator, schema, kind));
    const entries = new Map(this.#entries);
    if (acl.isEmpty) entries.delete(k);
    else entries.set(k, Object.freeze({ creator, schema, kind, acl }));
    return new DefaultPrivileges(entries);
  }
}
