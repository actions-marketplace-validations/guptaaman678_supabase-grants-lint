/** What every reporter prints: `--quiet` keeps error findings only and drops notices. */
import type { LintResult } from '../lint.js';
import type { Finding, Notice } from '../rules/types.js';

export interface ReportOptions {
  /** `--quiet`: report error findings only, no notices. The summary still counts everything. */
  readonly quiet?: boolean;
}

export function reportedFindings(result: LintResult, options: ReportOptions): readonly Finding[] {
  return options.quiet === true
    ? result.findings.filter((finding) => finding.severity === 'error')
    : result.findings;
}

export function reportedNotices(result: LintResult, options: ReportOptions): readonly Notice[] {
  return options.quiet === true ? [] : result.notices;
}
