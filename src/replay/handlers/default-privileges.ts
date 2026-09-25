/**
 * `ALTER DEFAULT PRIVILEGES [FOR ROLE r, ...] [IN SCHEMA s, ...] GRANT | REVOKE ... ON TABLES |
 * SEQUENCES` (spec §6.1). An omitted `FOR ROLE` means the current creator role; an omitted
 * `IN SCHEMA` means every schema. `REVOKE GRANT OPTION FOR` keeps the privilege.
 */
import type { AlterDefaultPrivileges } from '../../parse/ir.js';
import { expandPrivileges, PUBLIC } from '../../model/acl.js';
import { locate, type ReplayContext, resolveRole, resolveRoles } from '../context.js';

export function alterDefaultPrivileges(stmt: AlterDefaultPrivileges, ctx: ReplayContext): void {
  const at = locate(stmt);
  // `FOR ROLE PUBLIC` is a syntax error in Postgres; a role reference never resolves to PUBLIC here.
  const creators =
    stmt.forRoles === null
      ? [ctx.creator]
      : [...new Set(stmt.forRoles.map((r) => resolveRole(r, ctx)))].filter(
          (r): r is string => r !== PUBLIC,
        );
  const schemas = stmt.inSchemas ?? [null];
  const grantees = resolveRoles(stmt.grantees, ctx);
  const expanded = expandPrivileges(stmt.privileges, stmt.objectKind);
  const privileges = expanded.privileges.map((p) => p.name);
  const grantOptionOnly = stmt.action === 'revoke' && stmt.grantOption;
  if (!grantOptionOnly) {
    let defaults = ctx.catalog.defaults;
    for (const creator of creators) {
      for (const schema of schemas) {
        defaults =
          stmt.action === 'grant'
            ? defaults.grant(creator, schema, stmt.objectKind, grantees, privileges)
            : defaults.revoke(creator, schema, stmt.objectKind, grantees, privileges);
      }
    }
    ctx.catalog = ctx.catalog.withDefaults(defaults);
  }
  ctx.events.push({
    kind: 'defaultPrivileges',
    at,
    action: stmt.action,
    creators,
    schemas,
    object: stmt.objectKind,
    grantees,
    privileges,
    grantOptionOnly,
  });
  if (expanded.invalid.length > 0) {
    ctx.events.push({
      kind: 'skipped',
      at,
      reason: 'invalid-privilege',
      message: `Privilege not valid for default privileges on ${stmt.objectKind === 'table' ? 'tables' : 'sequences'}, not recorded: ${expanded.invalid.join(', ')}`,
    });
  }
}
