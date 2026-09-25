/**
 * The enforcement window (spec §6.1): rules GL001 to GL006 and GL008 check only files whose
 * version is strictly greater than the resolved `since`. Resolution order: the CLI `--since` flag,
 * then config `since` (a version, or `"none"` to enforce every file), then auto-detection of the
 * last opt-in migration. When nothing resolves, GL000 fires and those rules do not run.
 *
 * Versions compare by numeric value (leading zeros ignored), which for the usual equal-length
 * timestamps is the same as comparing them as strings and as the replay order (ADR-006). A file
 * without a version is enforced only under `"none"`: it has no version to be greater than `since`.
 */
import type { Since } from '../config/defaults.js';
import { DML_PRIVILEGES } from '../model/acl.js';
import { LEGACY_DEFAULTS } from '../model/defaults.js';
import type { SourceLocation } from '../parse/ir.js';
import type { ReplayOptions } from './context.js';
import {
  type EngineOptions,
  type FileReplay,
  replay,
  type ReplayInput,
  type ReplayResult,
} from './engine.js';

export type SinceSource = 'cli' | 'config' | 'auto';

export interface ResolvedSince {
  /** A version, `"none"` (every file is enforced), or `null` when nothing resolved (GL000). */
  readonly value: string | null;
  /** Where the value came from; `null` when nothing resolved. */
  readonly source: SinceSource | null;
  /** For `auto`: the detected opt-in migration and its first opt-in statement. */
  readonly detected: { readonly file: string; readonly at: SourceLocation } | null;
}

export interface WindowOptions extends Omit<EngineOptions, 'platformRevokeBefore'> {
  /** Config `since`: `"auto"`, `"none"` or a version. */
  readonly since: Since;
  /** The `--since` flag; takes precedence over config `since` when set. */
  readonly cliSince?: Since | undefined;
  /** Config `platformRevokeAtSince` (ADR-002 item 1). */
  readonly platformRevokeAtSince: boolean;
}

export interface WindowedReplay extends ReplayResult {
  readonly since: ResolvedSince;
  /** Whether GL001 to GL006 and GL008 check this file. */
  isEnforced(file: { readonly version: string | null }): boolean;
}

export interface OptIn {
  readonly file: string;
  readonly version: string;
  readonly at: SourceLocation;
}

const UNRESOLVED: ResolvedSince = { value: null, source: null, detected: null };

/** Compares two migration versions (digit strings) by numeric value. */
export function compareVersions(a: string, b: string): number {
  const x = a.replace(/^0+/, '');
  const y = b.replace(/^0+/, '');
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function isEnforced(since: ResolvedSince, version: string | null): boolean {
  if (since.value === null) return false;
  if (since.value === 'none') return true;
  return version !== null && compareVersions(version, since.value) > 0;
}

/**
 * The first statement of `file` that, together with the rest of the file, opts the project in:
 * `ALTER DEFAULT PRIVILEGES ... REVOKE` of select, insert, update and delete on tables from each of
 * `anon`, `authenticated` and `service_role`, for the migration role, in a configured schema or in
 * all schemas. Revokes may be spread over several statements of the file. `null` when the file
 * does not opt in (for example it revokes from only some of the roles).
 */
export function optInStatement(file: FileReplay, options: ReplayOptions): SourceLocation | null {
  const revoked = new Map<string, Set<string>>();
  let first: SourceLocation | null = null;
  for (const event of file.events) {
    if (
      event.kind !== 'defaultPrivileges' ||
      event.action !== 'revoke' ||
      event.object !== 'table' ||
      event.grantOptionOnly ||
      !event.creators.includes(options.migrationRole) ||
      !event.schemas.some((s) => s === null || options.schemas.includes(s))
    ) {
      continue;
    }
    first ??= event.at;
    for (const grantee of event.grantees) {
      if (typeof grantee !== 'string') continue;
      const privileges = revoked.get(grantee) ?? new Set<string>();
      for (const p of event.privileges) privileges.add(p);
      revoked.set(grantee, privileges);
    }
  }
  const optedIn = LEGACY_DEFAULTS.grantees.every((role) =>
    DML_PRIVILEGES.every((p) => revoked.get(role)?.has(p) === true),
  );
  return optedIn ? first : null;
}

/** The last versioned file that opts in (see `optInStatement`), or `null`. */
export function detectOptIn(files: readonly FileReplay[], options: ReplayOptions): OptIn | null {
  let found: OptIn | null = null;
  for (const file of files) {
    if (file.version === null) continue;
    const at = optInStatement(file, options);
    if (at !== null) found = { file: file.file, at, version: file.version };
  }
  return found;
}

/**
 * Resolves `since` and replays. When `since` is an explicit version (flag or config) and
 * `platformRevokeAtSince` is on, the announced platform revoke is assumed just before the first
 * enforced file (ADR-002 item 1); it is recorded as a `platformRevoke` event on that file.
 */
export function replayWithWindow(
  inputs: readonly ReplayInput[],
  options: WindowOptions,
): WindowedReplay {
  const { since: configSince, cliSince, platformRevokeAtSince, ...engine } = options;
  const setting = cliSince ?? configSince;
  if (setting === 'auto') {
    const result = replay(inputs, engine);
    const found = detectOptIn(result.files, engine);
    const since: ResolvedSince =
      found === null
        ? UNRESOLVED
        : { value: found.version, source: 'auto', detected: { file: found.file, at: found.at } };
    return windowed(result, since);
  }
  const since: ResolvedSince = {
    value: setting,
    source: cliSince === undefined ? 'config' : 'cli',
    detected: null,
  };
  const first = inputs.findIndex((input) => isEnforced(since, input.version));
  const revokeBefore = platformRevokeAtSince && setting !== 'none' && first >= 0 ? first : null;
  return windowed(replay(inputs, { ...engine, platformRevokeBefore: revokeBefore }), since);
}

function windowed(result: ReplayResult, since: ResolvedSince): WindowedReplay {
  return { ...result, since, isEnforced: (file) => isEnforced(since, file.version) };
}
