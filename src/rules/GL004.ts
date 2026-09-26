/**
 * GL004 serial-sequence-usage (spec §6.2): a relation created in an enforced file with a serial
 * column that a client role can insert into, while that role holds neither `usage` nor `update`
 * on the owned sequence. The column default calls `nextval()`, which accepts either privilege
 * (ADR-008: the platform revoke leaves sequence `update` in place), so without both every insert
 * that relies on it fails with 42501 permission denied for the sequence. Identity columns and uuid
 * keys create no sequence to track, so they never reach this rule.
 */
import type { SequencePrivilege } from '../model/acl.js';
import type { OwnedSequence } from '../model/relations.js';
import { grantSql } from '../fix/sql.js';
import { qualified } from '../replay/context.js';
import type { CreatedRelation } from '../replay/engine.js';
import { checkedClientRoles } from './client-roles.js';
import type { Rule, RuleFinding } from './types.js';

/** The sequence privileges `nextval()` accepts. The fix grants `usage`, the narrower one. */
const NEXTVAL_PRIVILEGES: readonly SequencePrivilege[] = ['usage', 'update'];

function finding(relation: CreatedRelation, sequence: OwnedSequence, role: string): RuleFinding {
  return {
    at: relation.created,
    message:
      `${qualified(relation)} has serial column ${sequence.ownedBy.column}, and ${role} can ` +
      `insert into it but holds no usage (or update) on its sequence ${qualified(sequence)}: ` +
      `inserts that rely on the column default fail with 42501 permission denied for sequence ` +
      `${sequence.name}. Grant ${role} usage on the sequence in the same migration.`,
    relation,
    role,
    privilege: 'usage',
    fix: grantSql({ privileges: ['usage'], relation: sequence, sequence: true, grantees: [role] }),
  };
}

export const GL004: Rule = {
  id: 'GL004',
  name: 'serial-sequence-usage',
  defaultSeverity: 'error',
  docs: 'A client role can insert into a new table but holds no usage (or update) on its serial sequence, so inserts fail with 42501.',
  check(ctx) {
    const roles = checkedClientRoles(ctx);
    return ctx.enforced.flatMap((file) =>
      file.created.flatMap((relation) =>
        file.after
          .ownedSequences(relation)
          .flatMap((sequence) =>
            roles
              .filter(
                (role) =>
                  relation.acl.holds(role, 'insert') &&
                  !NEXTVAL_PRIVILEGES.some((privilege) => sequence.acl.holds(role, privilege)),
              )
              .map((role) => finding(relation, sequence, role)),
          ),
      ),
    );
  },
};
