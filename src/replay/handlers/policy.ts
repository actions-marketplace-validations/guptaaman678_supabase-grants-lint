/**
 * `CREATE POLICY`, `ALTER POLICY [... TO ...]`, `ALTER POLICY ... RENAME TO` and `DROP POLICY`
 * (spec §6.1). Policies are recorded on any relation, including one the replay never saw created,
 * so the rules can warn about it.
 */
import type { AlterPolicy, CreatePolicy, DropPolicy, RenamePolicy } from '../../parse/ir.js';
import { locate, type ReplayContext, resolveName, resolveRoles } from '../context.js';

export function createPolicy(stmt: CreatePolicy, ctx: ReplayContext): void {
  const at = locate(stmt);
  const relation = resolveName(stmt.relation);
  const roles = resolveRoles(stmt.roles, ctx);
  ctx.catalog = ctx.catalog.putPolicy({
    name: stmt.name,
    relation,
    command: stmt.command,
    roles,
    permissive: stmt.permissive,
    using: stmt.using,
    withCheck: stmt.withCheck,
    created: at,
    altered: null,
  });
  ctx.events.push({
    kind: 'policy',
    at,
    action: 'create',
    relation,
    name: stmt.name,
    newName: stmt.name,
    known: true,
    command: stmt.command,
    roles,
  });
}

export function alterPolicy(stmt: AlterPolicy, ctx: ReplayContext): void {
  const at = locate(stmt);
  const relation = resolveName(stmt.relation);
  const existing = ctx.catalog.policy(relation, stmt.name);
  const roles = stmt.roles === null ? null : resolveRoles(stmt.roles, ctx);
  if (existing !== undefined) {
    ctx.catalog = ctx.catalog.putPolicy({
      ...existing,
      roles: roles ?? existing.roles,
      using: stmt.using ?? existing.using,
      withCheck: stmt.withCheck ?? existing.withCheck,
      altered: at,
    });
  }
  ctx.events.push({
    kind: 'policy',
    at,
    action: 'alter',
    relation,
    name: stmt.name,
    newName: stmt.name,
    known: existing !== undefined,
    command: existing?.command ?? null,
    roles: roles ?? existing?.roles ?? null,
  });
}

export function renamePolicy(stmt: RenamePolicy, ctx: ReplayContext): void {
  const relation = resolveName(stmt.relation);
  const existing = ctx.catalog.policy(relation, stmt.name);
  if (existing !== undefined && ctx.catalog.policy(relation, stmt.newName) === undefined) {
    ctx.catalog = ctx.catalog
      .dropPolicy(relation, stmt.name)
      .putPolicy({ ...existing, name: stmt.newName });
  }
  ctx.events.push({
    kind: 'policy',
    at: locate(stmt),
    action: 'rename',
    relation,
    name: stmt.name,
    newName: stmt.newName,
    known: existing !== undefined,
    command: existing?.command ?? null,
    roles: existing?.roles ?? null,
  });
}

export function dropPolicy(stmt: DropPolicy, ctx: ReplayContext): void {
  const relation = resolveName(stmt.relation);
  const existing = ctx.catalog.policy(relation, stmt.name);
  ctx.catalog = ctx.catalog.dropPolicy(relation, stmt.name);
  ctx.events.push({
    kind: 'policy',
    at: locate(stmt),
    action: 'drop',
    relation,
    name: stmt.name,
    newName: stmt.name,
    known: existing !== undefined,
    command: existing?.command ?? null,
    roles: existing?.roles ?? null,
  });
}
