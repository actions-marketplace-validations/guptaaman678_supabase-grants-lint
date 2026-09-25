/**
 * GL007 replay-reenables-defaults (spec §6.2): after the last file, the migrations themselves leave
 * default privileges that give a client role (`anon`, `authenticated`, config `clientRoles`, or
 * `PUBLIC`) or the service role privileges on the tables or sequences the creator role (config
 * `migrationRole`) creates in a scoped schema. Replaying the files (`supabase db reset`, a preview
 * branch) then grants new relations what production, with automatic grants off, does not.
 *
 * Only statements in the files count. The initial state (`platformDefaults`) and the platform
 * revoke assumed at `since` (ADR-002 item 1) describe production, while a replay runs the files
 * alone, so the rule replays just the files' `ALTER DEFAULT PRIVILEGES` onto empty defaults. It
 * reads every file, enforced or not, and reports once, at the last statement that granted
 * something still in effect: warn, or error when `since` was auto-detected and that statement
 * comes after the opt-in file.
 */
import { quoteIdent, sqlGrantee } from '../fix/sql.js';
import { type AclKind, type Grantee, PUBLIC, privilegesFor } from '../model/acl.js';
import { DefaultPrivileges } from '../model/defaults.js';
import type { DefaultPrivilegesEvent } from '../replay/context.js';
import { checkedClientRoles } from './client-roles.js';
import type { FileContext, Rule, RuleContext, RuleFinding } from './types.js';

const KINDS: readonly AclKind[] = ['table', 'sequence'];

interface Regrant {
  readonly file: FileContext;
  readonly event: DefaultPrivilegesEvent;
}

/** The default privileges the files alone leave, and every default-privileges grant in them. */
function fromFiles(files: readonly FileContext[]) {
  let defaults = DefaultPrivileges.EMPTY;
  const grants: Regrant[] = [];
  for (const file of files) {
    for (const event of file.events) {
      if (event.kind !== 'defaultPrivileges' || event.grantOptionOnly) continue;
      for (const creator of event.creators) {
        for (const schema of event.schemas) {
          defaults =
            event.action === 'grant'
              ? defaults.grant(creator, schema, event.object, event.grantees, event.privileges)
              : defaults.revoke(creator, schema, event.object, event.grantees, event.privileges);
        }
      }
      if (event.action === 'grant') grants.push({ file, event });
    }
  }
  return { defaults, grants };
}

/** A default-privileges entry of the creator that reaches new objects in a scoped schema. */
interface Entry {
  readonly kind: AclKind;
  /** `null` for the entry without `IN SCHEMA`, which applies in every schema. */
  readonly schema: string | null;
  readonly held: ReadonlyMap<Grantee, readonly string[]>;
}

function entries(ctx: RuleContext, defaults: DefaultPrivileges): Entry[] {
  const flagged = new Set<Grantee>([...checkedClientRoles(ctx), ctx.config.serviceRole, PUBLIC]);
  const schemas = [null, ...new Set(ctx.config.schemas)];
  return KINDS.flatMap((kind) =>
    schemas.flatMap((schema) => {
      const acl = defaults.entry(ctx.config.migrationRole, schema, kind);
      const held = new Map(
        [...flagged].map((g) => [g, acl.privileges(g)] as const).filter(([, p]) => p.length > 0),
      );
      return held.size === 0 ? [] : [{ kind, schema, held }];
    }),
  );
}

/** Whether the grant gave something an entry still holds. */
function stillInEffect(event: DefaultPrivilegesEvent, creator: string, found: readonly Entry[]) {
  return (
    event.creators.includes(creator) &&
    found.some(
      (entry) =>
        entry.kind === event.object &&
        event.schemas.includes(entry.schema) &&
        event.grantees.some((g) => event.privileges.some((p) => entry.held.get(g)?.includes(p))),
    )
  );
}

const label = (g: Grantee): string => (g === PUBLIC ? 'PUBLIC' : g);
const plural = (kind: AclKind): string => (kind === 'table' ? 'tables' : 'sequences');

function message(ctx: RuleContext, found: readonly Entry[]): string {
  const roles = [...new Set(found.flatMap((e) => [...e.held.keys()]))].map(label);
  const what = KINDS.flatMap((kind) => {
    const held = new Set(
      found.filter((e) => e.kind === kind).flatMap((e) => [...e.held.values()].flat()),
    );
    if (held.size === 0) return [];
    const all = privilegesFor(kind);
    const privileges = all.every((p) => held.has(p))
      ? 'all privileges'
      : all.filter((p) => held.has(p)).join(', ');
    return [`${privileges} on new ${plural(kind)}`];
  });
  const where = found.some((e) => e.schema === null)
    ? 'any schema'
    : `schema ${[...new Set(found.map((e) => e.schema))].join(', ')}`;
  return (
    `Replaying these migrations (supabase db reset, a preview branch) leaves default privileges ` +
    `that give ${roles.join(', ')} ${what.join(' and ')} ${ctx.config.migrationRole} creates in ` +
    `${where}, so new relations get grants there that production, with automatic grants off, ` +
    `does not give them. Revoke them in a new migration.`
  );
}

function fix(creator: string, found: readonly Entry[]): string {
  return found
    .map(
      (e) =>
        `alter default privileges for role ${quoteIdent(creator)}` +
        `${e.schema === null ? '' : ` in schema ${quoteIdent(e.schema)}`} revoke all on ` +
        `${plural(e.kind)} from ${[...e.held.keys()].map(sqlGrantee).join(', ')};`,
    )
    .join('\n');
}

export const GL007: Rule = {
  id: 'GL007',
  name: 'replay-reenables-defaults',
  defaultSeverity: 'warn',
  docs: 'The migrations leave default privileges that give API roles grants on new relations when they are replayed.',
  check(ctx) {
    const creator = ctx.config.migrationRole;
    const { defaults, grants } = fromFiles(ctx.files);
    const found = entries(ctx, defaults);
    const last = grants.findLast(({ event }) => stillInEffect(event, creator, found));
    if (last === undefined) return [];
    const regrantAfterOptIn = ctx.replay.since.source === 'auto' && last.file.enforced;
    const finding: RuleFinding = {
      at: last.event.at,
      message: message(ctx, found),
      fix: fix(creator, found),
      ...(regrantAfterOptIn ? { severity: 'error' as const } : {}),
    };
    return [finding];
  },
};
