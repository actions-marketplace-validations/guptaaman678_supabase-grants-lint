/**
 * `explain` (spec §6.3, T4.7): the grant timeline of one relation. Every migration line that
 * created, granted or revoked on, renamed, moved or dropped it, or created, altered, renamed or
 * dropped a policy on it, then its final effective privileges per role and its policies.
 *
 * A relation is followed through renames, so the old and the new name both find it. A name the
 * migrations reuse (dropped and created again, or freed by a rename) shows every relation that
 * carried it, in replay order. Reads files inside the project only (G4).
 */
import { type Colors, colors as makeColors } from './cli/color.js';
import { editDistance } from './config/validate.js';
import { UsageError } from './errors.js';
import { quoteIdent, sqlGrantee, sqlRelation } from './fix/sql.js';
import { type LintOptions, loadProject } from './lint.js';
import { type Acl, type Grantee, PUBLIC, TABLE_PRIVILEGES } from './model/acl.js';
import type { Relation, RelationName } from './model/relations.js';
import type { Privilege, SourceLocation } from './parse/ir.js';
import type {
  CreatedEvent,
  DroppedEvent,
  GrantEvent,
  MovedEvent,
  PolicyEvent,
  ReplayEvent,
} from './replay/context.js';
import { DEFAULT_SCHEMA } from './replay/context.js';
import { replayWithWindow } from './replay/since.js';

export interface ExplainOptions extends LintOptions {
  /** `schema.relation`, or a bare name in `public`; quoted parts keep their case. */
  readonly relation: string;
}

export type TimelineAction = 'create' | 'grant' | 'revoke' | 'rename' | 'move' | 'drop' | 'policy';

export interface TimelineEntry {
  readonly at: SourceLocation;
  readonly action: TimelineAction;
  readonly text: string;
}

export interface RolePrivileges {
  /** A role name, or `PUBLIC`. */
  readonly role: string;
  /** Effective privileges (own plus `PUBLIC`'s; `PUBLIC`'s own for `PUBLIC`), `(columns)` marked. */
  readonly privileges: readonly string[];
}

export interface FinalRelation {
  /** `schema.name` after the last migration. */
  readonly relation: string;
  readonly kind: Relation['kind'];
  readonly roles: readonly RolePrivileges[];
  /** One line per policy: name, command, roles. */
  readonly policies: readonly string[];
}

export interface Explanation {
  /** The name asked for, `schema.name`. */
  readonly relation: string;
  /** Every name the matching relations had, in replay order (includes `relation`). */
  readonly names: readonly string[];
  readonly timeline: readonly TimelineEntry[];
  /** The matching relations that exist after the last migration. */
  readonly final: readonly FinalRelation[];
  /** False when the migrations only grant on the name or add policies to it, never create it. */
  readonly createdByMigrations: boolean;
}

/** `public.todos`, `todos` (in `public`), `"My Table"`, `api."Orders"`: resolved like SQL. */
export function parseRelationName(input: string): RelationName {
  const part = String.raw`"(?:[^"]|"")+"|[^."\s]+`;
  const match = new RegExp(`^(${part})(?:\\.(${part}))?$`).exec(input.trim());
  if (match === null) {
    throw new UsageError(
      `explain expects <schema.relation> (for example public.todos), got "${input}".`,
    );
  }
  const [, first = '', second] = match;
  const ident = (text: string): string =>
    text.startsWith('"') ? text.slice(1, -1).replaceAll('""', '"') : text.toLowerCase();
  return second === undefined
    ? { schema: DEFAULT_SCHEMA, name: ident(first) }
    : { schema: ident(first), name: ident(second) };
}

function key({ schema, name }: RelationName): string {
  return JSON.stringify([schema, name]);
}

function display(name: RelationName): string {
  return sqlRelation(name);
}

type TimelineEvent = CreatedEvent | MovedEvent | DroppedEvent | GrantEvent | PolicyEvent;

interface Step {
  /** Replay order across every file. */
  readonly seq: number;
  readonly event: TimelineEvent;
  /** The relation's name when the event happened (for a grant: the name it changed). */
  readonly target: RelationName;
}

/** One relation from CREATE to DROP (or the end), or the events on a name it never created. */
interface History {
  readonly names: RelationName[];
  readonly steps: Step[];
  current: RelationName;
  alive: boolean;
  readonly created: CreatedEvent | null;
}

interface Histories {
  readonly relations: readonly History[];
  /** Keyed by name: grants and policies on relations the migrations never create. */
  readonly untracked: ReadonlyMap<string, History>;
}

/** Follows every relation through the replay events. */
function histories(events: readonly ReplayEvent[]): Histories {
  const relations: History[] = [];
  const alive = new Map<string, History>();
  const untracked = new Map<string, History>();
  let seq = 0;
  const outside = (name: RelationName): History => {
    const found = untracked.get(key(name));
    if (found !== undefined) return found;
    const history: History = {
      names: [name],
      steps: [],
      current: name,
      alive: false,
      created: null,
    };
    untracked.set(key(name), history);
    return history;
  };
  const add = (history: History, event: TimelineEvent, target = history.current): void => {
    history.steps.push({ seq: seq++, event, target });
  };

  for (const event of events) {
    if (event.kind === 'created' && event.object === 'relation') {
      const history: History = {
        names: [event.name],
        steps: [],
        current: event.name,
        alive: true,
        created: event,
      };
      relations.push(history);
      alive.set(key(event.name), history);
      add(history, event);
    } else if (event.kind === 'moved' && event.object === 'relation') {
      const history = alive.get(key(event.from));
      if (history === undefined) continue;
      alive.delete(key(event.from));
      history.current = event.to;
      history.names.push(event.to);
      alive.set(key(event.to), history);
      add(history, event);
    } else if (event.kind === 'dropped' && event.object === 'relation') {
      const history = alive.get(key(event.name));
      if (history === undefined) continue;
      alive.delete(key(event.name));
      history.alive = false;
      add(history, event);
    } else if (event.kind === 'grant' && event.objectKind === 'table') {
      for (const target of event.targets.filter((t) => t.object === 'table')) {
        const history = alive.get(key(target.name));
        if (history !== undefined) add(history, event, target.name);
      }
      for (const name of event.untracked) add(outside(name), event, name);
    } else if (event.kind === 'policy') {
      add(alive.get(key(event.relation)) ?? outside(event.relation), event);
    }
  }
  return { relations, untracked };
}

function privilegeList(privileges: readonly string[]): string {
  const all = TABLE_PRIVILEGES.every((p) => privileges.includes(p));
  return all ? 'all' : privileges.join(', ');
}

/** `default privileges give all to anon, authenticated`, grouping roles with the same privileges. */
function describeAcl(acl: Acl): string {
  const groups = new Map<string, string[]>();
  for (const grantee of acl.grantees()) {
    const privileges = privilegeList(TABLE_PRIVILEGES.filter((p) => acl.holdsOwn(grantee, p)));
    groups.set(privileges, [...(groups.get(privileges) ?? []), sqlGrantee(grantee)]);
  }
  if (groups.size === 0) return 'no default privileges';
  const gives = [...groups].map(
    ([privileges, grantees]) => `${privileges} to ${grantees.join(', ')}`,
  );
  return `default privileges give ${gives.join('; ')}`;
}

function writtenPrivilege({ name, columns }: Privilege): string {
  return columns === null ? name : `${name} (${columns.join(', ')})`;
}

function grantText(event: GrantEvent, target: RelationName): string {
  const option = event.grantOptionOnly ? 'grant option for ' : '';
  const on =
    event.allInSchemas === null
      ? display(target)
      : `all tables in schema ${event.allInSchemas.map(quoteIdent).join(', ')}`;
  const direction = event.action === 'grant' ? 'to' : 'from';
  const grantees = event.grantees.map(sqlGrantee).join(', ');
  return `${option}${event.written.map(writtenPrivilege).join(', ')} on ${on} ${direction} ${grantees}`;
}

function policyText(event: PolicyEvent): string {
  const name = `"${event.name}"`;
  switch (event.action) {
    case 'create':
      return (
        `create ${name} for ${event.command ?? 'all'} to ` +
        (event.roles ?? []).map(sqlGrantee).join(', ')
      );
    case 'alter':
      return `alter ${name}`;
    case 'rename':
      return `rename ${name} to "${event.newName}"`;
    case 'drop':
      return `drop ${name}`;
  }
}

function entry({ event, target }: Step): TimelineEntry {
  switch (event.kind) {
    case 'created':
      return {
        at: event.at,
        action: 'create',
        text:
          `${event.relationKind ?? 'relation'} ${display(event.name)} by ` +
          `${quoteIdent(event.creator)}; ${describeAcl(event.acl)}`,
      };
    case 'moved':
      return event.from.schema === event.to.schema
        ? { at: event.at, action: 'rename', text: `${display(event.from)} to ${display(event.to)}` }
        : { at: event.at, action: 'move', text: `${display(event.from)} to ${display(event.to)}` };
    case 'dropped':
      return { at: event.at, action: 'drop', text: display(event.name) };
    case 'grant':
      return { at: event.at, action: event.action, text: grantText(event, target) };
    case 'policy':
      return { at: event.at, action: 'policy', text: policyText(event) };
  }
}

function roleLabel(role: Grantee): string {
  return role === PUBLIC ? 'PUBLIC' : role;
}

function finalRoles(acl: Acl, roles: readonly string[]): RolePrivileges[] {
  const named = [
    ...new Set([...roles, ...acl.grantees().filter((g): g is string => g !== PUBLIC)]),
  ];
  const held = (role: Grantee, own: boolean): string[] =>
    TABLE_PRIVILEGES.filter((p) => (own ? acl.holdsOwn(role, p) : acl.holds(role, p)));
  const rows = named.map((role) => {
    const privileges = held(role, false);
    const scoped = privileges.some((p) => acl.columnScoped(role, p));
    return {
      role,
      privileges: scoped
        ? privileges.map((p) => (acl.columnScoped(role, p) ? `${p} (columns)` : p))
        : privileges,
    };
  });
  return [...rows, { role: roleLabel(PUBLIC), privileges: held(PUBLIC, true) }];
}

/** Builds the explanation. Rejects with a `UsageError` (exit 2) for an unknown relation. */
export async function explain(options: ExplainOptions): Promise<Explanation> {
  const wanted = parseRelationName(options.relation);
  const project = await loadProject(options);
  const { config } = project;
  const replay = replayWithWindow(project.inputs, { ...config, cliSince: project.cliSince });
  const { relations, untracked } = histories(replay.files.flatMap((file) => file.events));

  const matching = relations.filter((h) => h.names.some((n) => key(n) === key(wanted)));
  const outside = untracked.get(key(wanted));
  const selected = outside === undefined ? matching : [...matching, outside];
  if (selected.length === 0) {
    throw new UsageError(unknownMessage(wanted, [...relations, ...untracked.values()]));
  }

  const timeline = selected
    .flatMap((h) => h.steps)
    .sort((a, b) => a.seq - b.seq)
    .map(entry);
  const names = [...new Set(selected.flatMap((h) => h.names).map(display))];
  const roles = [...config.clientRoles, config.serviceRole];
  const final = matching.flatMap((h): FinalRelation[] => {
    const relation = h.alive ? replay.final.relation(h.current) : undefined;
    if (relation === undefined) return [];
    return [
      {
        relation: display(h.current),
        kind: relation.kind,
        roles: finalRoles(relation.acl, roles),
        policies: replay.final
          .policiesOn(h.current)
          .map(
            (p) =>
              `"${p.name}" for ${p.command} to ${p.roles.map(sqlGrantee).join(', ')}` +
              (p.permissive ? '' : ' (restrictive)'),
          ),
      },
    ];
  });
  return {
    relation: display(wanted),
    names,
    timeline,
    final,
    createdByMigrations: matching.length > 0,
  };
}

/** The error for a name no migration mentions, with the closest names that do. */
function unknownMessage(wanted: RelationName, known: readonly History[]): string {
  const asked = display(wanted);
  const names = [...new Set(known.flatMap((h) => h.names).map(display))];
  const head = `No migration creates, grants on or adds a policy to ${asked}.`;
  if (names.length === 0) return `${head} The migrations mention no relations.`;
  const closest = names
    .map((name, index) => ({ name, index, distance: editDistance(asked, name) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, 3)
    .map((c) => c.name);
  return `${head} Closest matches: ${closest.join(', ')}.`;
}

/** The explanation as text: the timeline grouped by file, then the final state. */
export function formatExplain(explanation: Explanation, c: Colors = makeColors(false)): string {
  const { relation, names, timeline, final } = explanation;
  const others = names.filter((n) => n !== relation);
  const title =
    `${relation}: grant timeline` +
    (others.length === 0 ? '' : ` (also named ${others.join(', ')})`);
  const blocks: string[][] = [[c.bold(title)]];

  const byFile = new Map<string, TimelineEntry[]>();
  for (const e of timeline) byFile.set(e.at.file, [...(byFile.get(e.at.file) ?? []), e]);
  const actionWidth = Math.max(...timeline.map((e) => e.action.length));
  for (const [file, entries] of byFile) {
    const where = (e: TimelineEntry): string => `${String(e.at.line)}:${String(e.at.column)}`;
    const whereWidth = Math.max(...entries.map((e) => where(e).length));
    blocks.push([
      c.bold(file),
      ...entries.map(
        (e) => `  ${where(e).padEnd(whereWidth)}  ${e.action.padEnd(actionWidth)}  ${e.text}`,
      ),
    ]);
  }

  if (!explanation.createdByMigrations) {
    blocks.push([
      `No migration creates ${relation}, so its privileges come from outside the migrations ` +
        'and are not known.',
    ]);
  } else if (final.length === 0) {
    blocks.push([`${relation} does not exist after the last migration.`]);
  }
  for (const f of final) {
    const width = Math.max(...f.roles.map((r) => r.role.length));
    blocks.push(
      [
        c.bold(`Final privileges on ${f.relation} (${f.kind})`),
        ...f.roles.map(
          (r) =>
            `  ${r.role.padEnd(width)}  ${r.privileges.length === 0 ? 'none' : privilegeList(r.privileges)}`,
        ),
      ],
      [
        c.bold(`Policies on ${f.relation}`),
        ...(f.policies.length === 0 ? ['  none'] : f.policies.map((p) => `  ${p}`)),
      ],
    );
  }
  return `${blocks.map((block) => block.join('\n')).join('\n\n')}\n`;
}
