/**
 * `SET [LOCAL] ROLE r` and `RESET ROLE` (spec §6.1): the creator role for the statements that
 * follow in the same file. Each file starts again as `migrationRole`.
 */
import type { SetRole } from '../../parse/ir.js';
import { locate, type ReplayContext } from '../context.js';

export function setRole(stmt: SetRole, ctx: ReplayContext): void {
  ctx.creator = stmt.role ?? ctx.options.migrationRole;
  ctx.events.push({ kind: 'creator', at: locate(stmt), role: ctx.creator });
}
