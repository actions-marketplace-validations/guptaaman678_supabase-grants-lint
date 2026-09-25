/**
 * GL008 leftover-privileges (spec §6.2): a relation created in an enforced file that a client role
 * can still truncate, reference or trigger on (and maintain, on Postgres 17 and later) at the end of
 * that file. The announced opt-in revoke and the platform revoke remove only select, insert, update
 * and delete, so the old `grant all` default leaves these behind. The Data API never needs them,
 * and TRUNCATE and REFERENCES are not subject to row security.
 */
import { type Grantee, PUBLIC } from '../model/acl.js';
import { revokeSql } from '../fix/sql.js';
import { qualified } from '../replay/context.js';
import type { CreatedRelation } from '../replay/engine.js';
import { checkedClientRoles } from './client-roles.js';
import type { Rule, RuleFinding } from './types.js';

/**
 * The leftover privileges on a server of this major version. MAINTAIN only exists from Postgres 17,
 * so before that `grant all` never gave it, and a `revoke` naming it fails.
 */
export function leftoverPrivileges(postgresMajor: number): readonly string[] {
  const always = ['truncate', 'references', 'trigger'];
  return postgresMajor >= 17 ? [...always, 'maintain'] : always;
}

function finding(
  relation: CreatedRelation,
  roles: readonly string[],
  held: readonly string[],
  privileges: readonly string[],
): RuleFinding {
  const name = qualified(relation);
  // Revoking from a role does not remove what it holds through PUBLIC.
  const grantees: Grantee[] = roles.filter((role) =>
    privileges.some((p) => relation.acl.holdsOwn(role, p)),
  );
  if (privileges.some((p) => relation.acl.holdsOwn(PUBLIC, p))) grantees.push(PUBLIC);
  return {
    at: relation.created,
    message:
      `${name} still grants ${held.join(', ')} to ${roles.join(', ')}, left over from the ` +
      'default privileges: the Data API never needs them, and TRUNCATE and REFERENCES are not ' +
      'subject to row level security. Revoke them in the same migration.',
    relation,
    fix: revokeSql({ privileges, relation, grantees }),
  };
}

export const GL008: Rule = {
  id: 'GL008',
  name: 'leftover-privileges',
  defaultSeverity: 'warn',
  docs: 'A new table or view still gives anon or authenticated truncate, references or trigger, which the Data API never needs.',
  check(ctx) {
    const privileges = leftoverPrivileges(ctx.config.postgresMajor);
    const clientRoles = checkedClientRoles(ctx);
    return ctx.enforced.flatMap((file) =>
      file.created.flatMap((relation) => {
        const roles = clientRoles.filter((role) =>
          privileges.some((p) => relation.acl.holds(role, p)),
        );
        if (roles.length === 0) return [];
        const held = privileges.filter((p) => roles.some((role) => relation.acl.holds(role, p)));
        return [finding(relation, roles, held, privileges)];
      }),
    );
  },
};
