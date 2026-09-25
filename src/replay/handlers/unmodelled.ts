/**
 * Statements the replay cannot model (spec §6.1). A `DO` block whose body mentions grants, tables,
 * policies or default privileges is recorded for PARSE002; an unparseable statement for PARSE001.
 * Both are skipped, and the replay continues.
 */
import type { DynamicSql, Unparseable } from '../../parse/ir.js';
import { locate, type ReplayContext } from '../context.js';

export function dynamicSql(stmt: DynamicSql, ctx: ReplayContext): void {
  if (stmt.mentions.length === 0) return;
  ctx.events.push({
    kind: 'skipped',
    at: locate(stmt),
    reason: 'dynamic-sql',
    message: `DO block not modelled; it mentions ${stmt.mentions.join(', ')}`,
  });
}

export function unparseable(stmt: Unparseable, ctx: ReplayContext): void {
  ctx.events.push({
    kind: 'skipped',
    at: locate(stmt),
    reason: 'unparseable',
    message: stmt.message,
  });
}
