/**
 * `DROP TABLE | VIEW | MATERIALIZED VIEW | FOREIGN TABLE | SEQUENCE` (spec §6.1). Dropping a relation
 * also drops its policies and the sequences its serial columns own. Objects that depend on it
 * through `CASCADE` (views over a dropped table) are not modelled.
 */
import type { DropObjects } from '../../parse/ir.js';
import { locate, type ReplayContext, resolveName } from '../context.js';

export function dropObjects(stmt: DropObjects, ctx: ReplayContext): void {
  const at = locate(stmt);
  for (const written of stmt.objects) {
    const name = resolveName(written);
    if (stmt.objectKind === 'sequence') {
      if (ctx.catalog.sequence(name) === undefined) continue;
      ctx.catalog = ctx.catalog.dropSequence(name);
      ctx.events.push({ kind: 'dropped', at, object: 'sequence', name });
      continue;
    }
    // Policies on a relation the catalog never saw created go with it too.
    const tracked = ctx.catalog.relation(name) !== undefined;
    ctx.catalog = ctx.catalog.dropRelation(name);
    if (tracked) ctx.events.push({ kind: 'dropped', at, object: 'relation', name });
  }
}
