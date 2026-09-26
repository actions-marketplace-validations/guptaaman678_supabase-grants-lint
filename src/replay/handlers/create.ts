/**
 * `CREATE TABLE | VIEW | MATERIALIZED VIEW | FOREIGN TABLE` and `CREATE SEQUENCE` (spec §6.1).
 * A new object receives the creator role's default privileges; a serial column also creates its
 * owned sequence `<table>_<column>_seq` with the creator's sequence defaults.
 */
import type { CreateRelation, CreateSequence } from '../../parse/ir.js';
import type { RelationName } from '../../model/relations.js';
import { locate, type ReplayContext, resolveName } from '../context.js';

function isTracked(ctx: ReplayContext, name: RelationName): boolean {
  return ctx.catalog.relation(name) !== undefined || ctx.catalog.sequence(name) !== undefined;
}

export function createRelation(stmt: CreateRelation, ctx: ReplayContext): void {
  if (stmt.temporary) return;
  const name = resolveName(stmt.relation);
  // `IF NOT EXISTS` on an existing relation is a no-op, and `OR REPLACE` keeps the view's ACL.
  // A plain duplicate CREATE fails in Postgres; the existing relation is kept either way.
  if (isTracked(ctx, name)) return;
  const at = locate(stmt);
  ctx.catalog = ctx.catalog.createRelation(name, stmt.relationKind, ctx.creator, at);
  ctx.events.push({
    kind: 'created',
    at,
    object: 'relation',
    name,
    relationKind: stmt.relationKind,
    creator: ctx.creator,
    acl: ctx.catalog.defaults.effective(ctx.creator, name.schema, 'table'),
    ownedBy: null,
  });
  for (const { column } of stmt.serialColumns) {
    const sequence = { schema: name.schema, name: `${name.name}_${column}_seq` };
    // Postgres picks another name when this one is taken; that sequence is not modelled.
    if (isTracked(ctx, sequence)) continue;
    const ownedBy = { relation: name, column };
    ctx.catalog = ctx.catalog.createSequence(sequence, ctx.creator, at, ownedBy);
    ctx.events.push({
      kind: 'created',
      at,
      object: 'sequence',
      name: sequence,
      relationKind: null,
      creator: ctx.creator,
      acl: ctx.catalog.defaults.effective(ctx.creator, name.schema, 'sequence'),
      ownedBy,
    });
  }
}

export function createSequence(stmt: CreateSequence, ctx: ReplayContext): void {
  if (stmt.temporary) return;
  const name = resolveName(stmt.sequence);
  if (isTracked(ctx, name)) return;
  const at = locate(stmt);
  ctx.catalog = ctx.catalog.createSequence(name, ctx.creator, at);
  ctx.events.push({
    kind: 'created',
    at,
    object: 'sequence',
    name,
    relationKind: null,
    creator: ctx.creator,
    acl: ctx.catalog.defaults.effective(ctx.creator, name.schema, 'sequence'),
    ownedBy: null,
  });
}
