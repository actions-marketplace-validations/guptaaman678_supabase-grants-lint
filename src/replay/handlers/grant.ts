/**
 * `GRANT | REVOKE` on named relations, sequences, `ALL TABLES IN SCHEMA` and `ALL SEQUENCES IN
 * SCHEMA` (spec §6.1). `ALL ... IN SCHEMA` changes the objects that exist at that point only.
 * `REVOKE GRANT OPTION FOR` keeps the privilege. `ON [TABLE]` accepts a sequence name, as Postgres
 * does, and then records the privileges valid for sequences.
 */
import type { Grant } from '../../parse/ir.js';
import { type Acl, type AclKind, expandPrivileges } from '../../model/acl.js';
import type { RelationName } from '../../model/relations.js';
import {
  type GrantTarget,
  locate,
  qualified,
  type ReplayContext,
  resolveName,
  resolveRoles,
} from '../context.js';

interface Resolved {
  readonly object: AclKind;
  readonly name: RelationName;
  /** The object's ACL before this statement. */
  readonly acl: Acl;
}

function resolveTargets(
  stmt: Grant,
  ctx: ReplayContext,
): { targets: Resolved[]; untracked: RelationName[] } {
  const { catalog } = ctx;
  if (stmt.target.kind === 'allInSchema') {
    const schemas = new Set(stmt.target.schemas);
    const objects =
      stmt.objectKind === 'table'
        ? catalog.relations().map((found) => ({ object: 'table' as const, found }))
        : catalog.sequences().map((found) => ({ object: 'sequence' as const, found }));
    return {
      targets: objects
        .filter(({ found }) => schemas.has(found.schema))
        .map(({ object, found }) => ({
          object,
          name: { schema: found.schema, name: found.name },
          acl: found.acl,
        })),
      untracked: [],
    };
  }
  const targets: Resolved[] = [];
  const untracked: RelationName[] = [];
  const seen = new Set<string>();
  for (const written of stmt.target.objects) {
    const name = resolveName(written);
    if (seen.has(qualified(name))) continue;
    seen.add(qualified(name));
    const relation = stmt.objectKind === 'table' ? catalog.relation(name) : undefined;
    const sequence = catalog.sequence(name);
    if (relation !== undefined) targets.push({ object: 'table', name, acl: relation.acl });
    else if (sequence !== undefined) targets.push({ object: 'sequence', name, acl: sequence.acl });
    else untracked.push(name);
  }
  return { targets, untracked };
}

export function grant(stmt: Grant, ctx: ReplayContext): void {
  const at = locate(stmt);
  const grantees = resolveRoles(stmt.grantees, ctx);
  const grantOptionOnly = stmt.action === 'revoke' && stmt.grantOption;
  const { targets, untracked } = resolveTargets(stmt, ctx);
  const recorded: GrantTarget[] = [];
  const invalid = new Set<string>();
  for (const { object, name, acl } of targets) {
    const expanded = expandPrivileges(stmt.privileges, object);
    for (const written of expanded.invalid) invalid.add(`${written} on ${qualified(name)}`);
    recorded.push({ object, name, privileges: expanded.privileges });
    if (grantOptionOnly) continue;
    const next =
      stmt.action === 'grant'
        ? acl.grant(grantees, expanded.privileges)
        : acl.revoke(grantees, expanded.privileges);
    ctx.catalog =
      object === 'table'
        ? ctx.catalog.setRelationAcl(name, next)
        : ctx.catalog.setSequenceAcl(name, next);
  }
  ctx.events.push({
    kind: 'grant',
    at,
    action: stmt.action,
    objectKind: stmt.objectKind,
    written: stmt.privileges,
    allInSchemas: stmt.target.kind === 'allInSchema' ? stmt.target.schemas : null,
    grantees,
    grantOptionOnly,
    targets: recorded,
    untracked,
  });
  if (invalid.size > 0) {
    ctx.events.push({
      kind: 'skipped',
      at,
      reason: 'invalid-privilege',
      message: `Privilege not valid for the object, not recorded: ${[...invalid].join('; ')}`,
    });
  }
}
