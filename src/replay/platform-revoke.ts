/**
 * The revoke Supabase applies outside the migrations (ADR-002 item 1): from the dashboard when a
 * project opts in, or server-side for every existing project on 2026-10-30. Such projects have no
 * revoke statement in their history, so when `since` is set explicitly the replay assumes it just
 * before the first enforced file. Per the SQL Supabase published, it removes select, insert,
 * update, delete on tables and usage, select on sequences; TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
 * and sequence UPDATE stay.
 */
import type { AclKind } from '../model/acl.js';
import { LEGACY_DEFAULTS } from '../model/defaults.js';
import type { Catalog } from '../model/relations.js';
import type { PlatformRevokeEvent } from './context.js';

export const PLATFORM_REVOKE: Readonly<Record<AclKind, readonly string[]>> = {
  table: ['select', 'insert', 'update', 'delete'],
  sequence: ['usage', 'select'],
};

/**
 * Applies the platform revoke for `creator` in `public` before `file`. Returns the new catalog and
 * the event to record, or `null` when the creator's defaults there hold none of the privileges.
 */
export function applyPlatformRevoke(
  catalog: Catalog,
  creator: string,
  file: string,
): { catalog: Catalog; event: PlatformRevokeEvent } | null {
  const { schema, grantees } = LEGACY_DEFAULTS;
  let defaults = catalog.defaults;
  const removed: PlatformRevokeEvent['removed'][number][] = [];
  for (const object of ['table', 'sequence'] as const) {
    const entry = defaults.entry(creator, schema, object);
    for (const grantee of grantees) {
      const privileges = PLATFORM_REVOKE[object].filter((p) => entry.holdsOwn(grantee, p));
      if (privileges.length > 0) removed.push({ object, grantee, privileges });
    }
    defaults = defaults.revoke(creator, schema, object, grantees, PLATFORM_REVOKE[object]);
  }
  if (removed.length === 0) return null;
  return {
    catalog: catalog.withDefaults(defaults),
    event: {
      kind: 'platformRevoke',
      at: { file, line: 1, column: 1 },
      creator,
      schema,
      removed,
    },
  };
}
