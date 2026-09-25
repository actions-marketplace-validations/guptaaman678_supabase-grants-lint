/**
 * GL001 missing-service-role-grant (spec §6.2): a relation created in an enforced file that the
 * service role holds no privilege on at the end of that file. `service_role` bypasses RLS, not
 * grants, so server code (edge functions, admin tools) gets 42501 on it.
 */
import { DML_PRIVILEGES, TABLE_PRIVILEGES } from '../model/acl.js';
import { grantSql } from '../fix/sql.js';
import { qualified } from '../replay/context.js';
import type { CreatedRelation } from '../replay/engine.js';
import type { Rule, RuleFinding } from './types.js';

/** What the fix grants: views are read through, so they need `select` only. */
function fixPrivileges(relation: CreatedRelation): readonly string[] {
  return relation.kind === 'view' || relation.kind === 'materialized view'
    ? ['select']
    : DML_PRIVILEGES;
}

function finding(relation: CreatedRelation, role: string): RuleFinding {
  const name = qualified(relation);
  return {
    at: relation.created,
    message:
      `${name} is created without a grant to ${role}: server-side requests as ${role} ` +
      `(edge functions, admin tools) fail with 42501 permission denied, because ${role} ` +
      'bypasses RLS but not grants. Grant it the privileges it needs in the same migration.',
    relation,
    role,
    fix: grantSql({ privileges: fixPrivileges(relation), relation, grantees: [role] }),
  };
}

export const GL001: Rule = {
  id: 'GL001',
  name: 'missing-service-role-grant',
  defaultSeverity: 'error',
  docs: 'A new table or view gives service_role no privilege, so server-side requests fail with 42501.',
  check(ctx) {
    const role = ctx.config.serviceRole;
    return ctx.enforced.flatMap((file) =>
      file.created
        .filter((relation) => !TABLE_PRIVILEGES.some((p) => relation.acl.holds(role, p)))
        .map((relation) => finding(relation, role)),
    );
  },
};
