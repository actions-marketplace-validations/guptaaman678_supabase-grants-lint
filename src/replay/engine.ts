/**
 * The replay engine (spec §6.1): applies every statement of every migration, in order, to the
 * catalog, and keeps the catalog as it stands at the end of each file. Rules read those end-of-file
 * snapshots: grants later in the same file count, grants in a later file do not.
 */
import type { PlatformDefaults } from '../config/defaults.js';
import { DefaultPrivileges } from '../model/defaults.js';
import { Catalog, type Policy, type Relation, type RelationName } from '../model/relations.js';
import type { Statement } from '../parse/ir.js';
import type { ReplayContext, ReplayEvent, ReplayOptions } from './context.js';
import { createRelation, createSequence } from './handlers/create.js';
import { alterDefaultPrivileges } from './handlers/default-privileges.js';
import { dropObjects } from './handlers/drop.js';
import { grant } from './handlers/grant.js';
import { renameObject, setSchema } from './handlers/move.js';
import { alterPolicy, createPolicy, dropPolicy, renamePolicy } from './handlers/policy.js';
import { setRole } from './handlers/role.js';
import { dynamicSql, unparseable } from './handlers/unmodelled.js';

export interface ReplayInput {
  /** Path used in locations (relative to the working directory, `/` separators). */
  readonly file: string;
  readonly version: string | null;
  readonly statements: readonly Statement[];
}

export interface EngineOptions extends ReplayOptions {
  /** The default privileges in place before the first file (config `platformDefaults`). */
  readonly platformDefaults: PlatformDefaults;
}

export interface FileReplay {
  readonly file: string;
  readonly version: string | null;
  /** Position in replay order, from 0. */
  readonly index: number;
  /** The catalog before the file's first statement. */
  readonly before: Catalog;
  /** The catalog at the end of the file: the snapshot rules evaluate. */
  readonly after: Catalog;
  /** What each statement did, in order. */
  readonly events: readonly ReplayEvent[];
  /** In-scope relations that exist at the end of the file and were created in it. */
  readonly created: readonly Relation[];
  /** Policies on in-scope relations, at the end of the file, created or altered in it. */
  readonly policies: readonly Policy[];
}

export interface ReplayResult {
  readonly initial: Catalog;
  readonly files: readonly FileReplay[];
  /** The catalog after the last file. */
  readonly final: Catalog;
  /** Whether rules check a relation in this schema (config `schemas`). */
  inScope(name: RelationName): boolean;
}

function apply(stmt: Statement, ctx: ReplayContext): void {
  switch (stmt.kind) {
    case 'CreateRelation':
      createRelation(stmt, ctx);
      break;
    case 'CreateSequence':
      createSequence(stmt, ctx);
      break;
    case 'RenameObject':
      renameObject(stmt, ctx);
      break;
    case 'SetSchema':
      setSchema(stmt, ctx);
      break;
    case 'DropObjects':
      dropObjects(stmt, ctx);
      break;
    case 'Grant':
      grant(stmt, ctx);
      break;
    case 'AlterDefaultPrivileges':
      alterDefaultPrivileges(stmt, ctx);
      break;
    case 'CreatePolicy':
      createPolicy(stmt, ctx);
      break;
    case 'AlterPolicy':
      alterPolicy(stmt, ctx);
      break;
    case 'RenamePolicy':
      renamePolicy(stmt, ctx);
      break;
    case 'DropPolicy':
      dropPolicy(stmt, ctx);
      break;
    case 'SetRole':
      setRole(stmt, ctx);
      break;
    case 'DynamicSql':
      dynamicSql(stmt, ctx);
      break;
    case 'Unparseable':
      unparseable(stmt, ctx);
      break;
    case 'Unknown':
      // Valid SQL the model does not need (functions, comments, ALTER TABLE ... ADD COLUMN).
      break;
  }
}

export function replay(inputs: readonly ReplayInput[], options: EngineOptions): ReplayResult {
  const schemas = new Set(options.schemas);
  const inScope = (name: RelationName): boolean => schemas.has(name.schema);
  const initial = Catalog.create(DefaultPrivileges.initial(options.platformDefaults));
  let catalog = initial;
  const files = inputs.map((input, index): FileReplay => {
    const ctx: ReplayContext = {
      options,
      catalog,
      creator: options.migrationRole,
      events: [],
    };
    for (const stmt of input.statements) apply(stmt, ctx);
    const before = catalog;
    catalog = ctx.catalog;
    const inFile = (at: { file: string } | null): boolean => at?.file === input.file;
    return {
      file: input.file,
      version: input.version,
      index,
      before,
      after: catalog,
      events: ctx.events,
      created: catalog.relations().filter((r) => inScope(r) && inFile(r.created)),
      policies: catalog
        .policies()
        .filter((p) => inScope(p.relation) && (inFile(p.created) || inFile(p.altered))),
    };
  });
  return { initial, files, final: catalog, inScope };
}
