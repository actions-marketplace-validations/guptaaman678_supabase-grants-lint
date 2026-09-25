/**
 * GL005 blanket-grant (spec §6.2): `GRANT ... ON ALL TABLES | ALL SEQUENCES IN SCHEMA` on a scoped
 * schema, to a client role (`anon`, `authenticated`, config `clientRoles`, or `PUBLIC`) or the
 * service role, in an enforced file. It re-grants every object that exists at that point,
 * including ones an earlier migration deliberately narrowed, and none created later. One finding
 * per statement; revokes are not flagged.
 */
import { type Grantee, PUBLIC } from '../model/acl.js';
import type { RelationName } from '../model/relations.js';
import type { Privilege } from '../parse/ir.js';
import { quoteIdent, sqlGrantee, sqlRelation } from '../fix/sql.js';
import { type GrantEvent, qualified, type ReplayEvent } from '../replay/context.js';
import { checkedClientRoles } from './client-roles.js';
import type { FileContext, Rule, RuleContext, RuleFinding } from './types.js';

function privilegeSql({ name, columns }: Privilege): string {
  return columns === null ? name : `${name} (${columns.map(quoteIdent).join(', ')})`;
}

type BlanketGrant = GrantEvent & { readonly allInSchemas: readonly string[] };

function isBlanketGrant(event: ReplayEvent): event is BlanketGrant {
  return event.kind === 'grant' && event.action === 'grant' && event.allInSchemas !== null;
}

/**
 * The same grant on the scoped objects this file created, which is what a blanket grant in a
 * migration usually means; `undefined` when it created none of them.
 */
function fixSql(event: GrantEvent, file: FileContext, targets: readonly RelationName[]) {
  const object = event.objectKind === 'table' ? 'relation' : 'sequence';
  const created = new Set(
    file.events.flatMap((e) =>
      e.kind === 'created' && e.object === object ? [qualified(e.name)] : [],
    ),
  );
  const named = targets.filter((t) => created.has(qualified(t)));
  if (named.length === 0) return undefined;
  const on = event.objectKind === 'sequence' ? 'sequence ' : '';
  return (
    `grant ${event.written.map(privilegeSql).join(', ')} on ${on}` +
    `${named.map(sqlRelation).join(', ')} to ${event.grantees.map(sqlGrantee).join(', ')};`
  );
}

function finding(
  ctx: RuleContext,
  file: FileContext,
  event: GrantEvent,
  schemas: readonly string[],
  roles: readonly Grantee[],
): RuleFinding {
  const kind = event.objectKind === 'table' ? 'tables' : 'sequences';
  const noun = event.objectKind === 'table' ? 'relation' : 'sequence';
  const targets = event.targets.filter((t) => ctx.inScope(t.name)).map((t) => t.name);
  const count = `${String(targets.length)} ${noun}${targets.length === 1 ? '' : 's'}`;
  const fix = fixSql(event, file, targets);
  return {
    at: event.at,
    message:
      `This grant on all ${kind} in schema ${schemas.join(', ')} to ` +
      `${roles.map((r) => (r === PUBLIC ? 'PUBLIC' : r)).join(', ')} applies to every ${noun} ` +
      `that exists there at this point (${count}), including any deliberately narrowed earlier, ` +
      `and to none created later. Grant on the ${noun}s by name instead.`,
    ...(fix === undefined ? {} : { fix }),
  };
}

export const GL005: Rule = {
  id: 'GL005',
  name: 'blanket-grant',
  defaultSeverity: 'warn',
  docs: 'A grant on all tables or all sequences in a schema re-grants every existing object, including deliberately narrowed ones.',
  check(ctx) {
    const flagged = new Set<Grantee>([PUBLIC, ...checkedClientRoles(ctx), ctx.config.serviceRole]);
    return ctx.enforced.flatMap((file) =>
      file.events.filter(isBlanketGrant).flatMap((event) => {
        const schemas = event.allInSchemas.filter((s) => ctx.config.schemas.includes(s));
        const roles = event.grantees.filter((g) => flagged.has(g));
        if (schemas.length === 0 || roles.length === 0) return [];
        return [finding(ctx, file, event, schemas, roles)];
      }),
    );
  },
};
