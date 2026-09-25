/**
 * GL006 default-privileges-regrant (spec §6.2): `ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES |
 * SEQUENCES` to a client role (`anon`, `authenticated`, config `clientRoles`, or `PUBLIC`) or the
 * service role, for the creator role, in a scoped schema (or every schema), in an enforced file. It
 * turns automatic grants back on for every object created afterwards, which is what the opt-in
 * removed. The creator role is config `migrationRole` or the role `SET ROLE` made current at that
 * statement. One finding per statement; revokes are not flagged. The fix is to delete the
 * statement, so the finding carries no fix SQL.
 */
import { type Grantee, PUBLIC, privilegesFor } from '../model/acl.js';
import type { DefaultPrivilegesEvent } from '../replay/context.js';
import { checkedClientRoles } from './client-roles.js';
import type { FileContext, Rule, RuleContext, RuleFinding } from './types.js';

/** Each default-privileges grant in the file, with the creator role current at that statement. */
function regrants(ctx: RuleContext, file: FileContext) {
  let current = ctx.config.migrationRole;
  const found: { event: DefaultPrivilegesEvent; current: string }[] = [];
  for (const event of file.events) {
    if (event.kind === 'creator') current = event.role;
    else if (event.kind === 'defaultPrivileges' && event.action === 'grant') {
      found.push({ event, current });
    }
  }
  return found;
}

function finding(
  event: DefaultPrivilegesEvent,
  creators: readonly string[],
  schemas: readonly (string | null)[],
  roles: readonly Grantee[],
): RuleFinding {
  const noun = event.object === 'table' ? 'table' : 'sequence';
  const all = privilegesFor(event.object).every((p) => event.privileges.includes(p));
  const where = schemas.includes(null) ? 'any schema' : `schema ${schemas.join(', ')}`;
  return {
    at: event.at,
    message:
      `This default privilege gives ${roles.map((r) => (r === PUBLIC ? 'PUBLIC' : r)).join(', ')} ` +
      `${all ? 'all privileges' : event.privileges.join(', ')} on every ${noun} ` +
      `${creators.join(', ')} creates in ${where} from here on, turning automatic Data API grants ` +
      `back on after the opt-in. Remove it and grant on each new ${noun} by name.`,
  };
}

export const GL006: Rule = {
  id: 'GL006',
  name: 'default-privileges-regrant',
  defaultSeverity: 'error',
  docs: 'A default privilege grant to an API role turns automatic grants back on for every relation created afterwards.',
  check(ctx) {
    const flagged = new Set<Grantee>([PUBLIC, ...checkedClientRoles(ctx), ctx.config.serviceRole]);
    return ctx.enforced.flatMap((file) =>
      regrants(ctx, file).flatMap(({ event, current }) => {
        const creators = event.creators.filter(
          (c) => c === ctx.config.migrationRole || c === current,
        );
        const schemas = event.schemas.filter((s) => s === null || ctx.config.schemas.includes(s));
        const roles = event.grantees.filter((g) => flagged.has(g));
        // A grant of privileges invalid for the object kind records none (Postgres rejects it).
        const grantsNothing = event.privileges.length === 0;
        if (grantsNothing || [creators, schemas, roles].some((list) => list.length === 0))
          return [];
        return [finding(event, creators, schemas, roles)];
      }),
    );
  },
};
