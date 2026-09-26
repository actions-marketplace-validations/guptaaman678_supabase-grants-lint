/**
 * Machine-readable output (spec §6.3). The shape is versioned by `schemaVersion`: fields may be
 * added, but removing or changing one needs a new `schemaVersion` (and a major release after 1.0).
 */
import type { LintResult } from '../lint.js';
import type { ResolvedSince } from '../replay/since.js';
import type { Finding, Notice } from '../rules/types.js';
import { version } from '../version.js';
import { type ReportOptions, reportedFindings, reportedNotices } from './select.js';

export const JSON_SCHEMA_VERSION = 1;

export interface JsonReport {
  readonly schemaVersion: typeof JSON_SCHEMA_VERSION;
  readonly tool: { readonly name: 'supabase-grants-lint'; readonly version: string };
  readonly summary: {
    readonly files: number;
    readonly relations: number;
    readonly errors: number;
    readonly warnings: number;
    /** Info-level findings plus notices. */
    readonly notices: number;
    readonly durationMs: number;
    /** The enforcement window: where `since` came from, or `value: null` when nothing resolved. */
    readonly since: ResolvedSince;
  };
  /** With `--quiet`, error findings only. */
  readonly findings: readonly Finding[];
  /** With `--quiet`, empty. */
  readonly notices: readonly Notice[];
}

/** Copies the known fields in a fixed order, leaving out the ones a finding does not have. */
function finding(f: Finding): Finding {
  return {
    ruleId: f.ruleId,
    severity: f.severity,
    message: f.message,
    file: f.file,
    line: f.line,
    column: f.column,
    ...(f.relation === undefined ? {} : { relation: f.relation }),
    ...(f.role === undefined ? {} : { role: f.role }),
    ...(f.privilege === undefined ? {} : { privilege: f.privilege }),
    ...(f.fix === undefined ? {} : { fix: f.fix }),
    docsUrl: f.docsUrl,
  };
}

function notice(n: Notice): Notice {
  return {
    code: n.code,
    message: n.message,
    ...(n.file === undefined ? {} : { file: n.file }),
    ...(n.line === undefined ? {} : { line: n.line }),
    ...(n.column === undefined ? {} : { column: n.column }),
  };
}

export function jsonReport(result: LintResult, options: ReportOptions = {}): JsonReport {
  const { files, relations, errors, warnings, notices, durationMs } = result.summary;
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    tool: { name: 'supabase-grants-lint', version },
    summary: { files, relations, errors, warnings, notices, durationMs, since: result.since },
    findings: reportedFindings(result, options).map(finding),
    notices: reportedNotices(result, options).map(notice),
  };
}

export function formatJson(result: LintResult, options: ReportOptions = {}): string {
  return `${JSON.stringify(jsonReport(result, options), null, 2)}\n`;
}
