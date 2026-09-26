/**
 * SARIF 2.1.0 output (spec §6.3) for GitHub code scanning and other SARIF viewers. One
 * `reportingDescriptor` per rule, with `helpUri` pinned to the release tag; one result per finding;
 * notices become tool execution notifications.
 */
import type { LintResult } from '../lint.js';
import { docsUrl, type Rule, RULES, type Severity } from '../rules/index.js';
import type { Finding, Notice } from '../rules/types.js';
import { version } from '../version.js';
import { type ReportOptions, reportedFindings, reportedNotices } from './select.js';

export type SarifLevel = 'error' | 'warning' | 'note';

export interface SarifReportingDescriptor {
  readonly id: string;
  readonly name: string;
  readonly shortDescription: { readonly text: string };
  readonly helpUri: string;
  readonly defaultConfiguration: { readonly level: SarifLevel };
}

const LEVELS: Readonly<Record<Severity, SarifLevel>> = {
  error: 'error',
  warn: 'warning',
  info: 'note',
};

const SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
const INFORMATION_URI = 'https://github.com/guptaaman678/supabase-grants-lint';

export function sarifLevel(severity: Severity): SarifLevel {
  return LEVELS[severity];
}

/** The `tool.driver.rules` array: one descriptor per implemented rule, in rule ID order. */
export function sarifRules(rules: readonly Rule[] = RULES): SarifReportingDescriptor[] {
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.docs },
    helpUri: docsUrl(rule.id),
    defaultConfiguration: { level: sarifLevel(rule.defaultSeverity) },
  }));
}

/** A relative URI reference for a migration path (`/` separators), each segment escaped. */
export function artifactUri(file: string): string {
  return file.split('/').map(encodeURIComponent).join('/');
}

function location(file: string, line?: number, column?: number) {
  return {
    physicalLocation: {
      artifactLocation: { uri: artifactUri(file) },
      ...(line === undefined
        ? {}
        : {
            region: { startLine: line, ...(column === undefined ? {} : { startColumn: column }) },
          }),
    },
  };
}

function result(finding: Finding, ruleIndex: number) {
  const text =
    finding.fix === undefined ? finding.message : `${finding.message}\nFix: ${finding.fix}`;
  const properties = {
    ...(finding.relation === undefined ? {} : { relation: finding.relation }),
    ...(finding.role === undefined ? {} : { role: finding.role }),
    ...(finding.privilege === undefined ? {} : { privilege: finding.privilege }),
    ...(finding.fix === undefined ? {} : { fix: finding.fix }),
  };
  return {
    ruleId: finding.ruleId,
    ruleIndex,
    level: sarifLevel(finding.severity),
    message: { text },
    locations: [location(finding.file, finding.line, finding.column)],
    ...(Object.keys(properties).length === 0 ? {} : { properties }),
  };
}

function notification(notice: Notice) {
  return {
    level: 'note' as const,
    message: { text: notice.message },
    descriptor: { id: notice.code },
    ...(notice.file === undefined
      ? {}
      : { locations: [location(notice.file, notice.line, notice.column)] }),
  };
}

export function sarifLog(lint: LintResult, options: ReportOptions = {}) {
  const rules = sarifRules();
  const ids = rules.map((rule) => rule.id);
  return {
    $schema: SCHEMA,
    version: '2.1.0' as const,
    runs: [
      {
        tool: {
          driver: {
            name: 'supabase-grants-lint',
            version,
            semanticVersion: version,
            informationUri: INFORMATION_URI,
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            toolExecutionNotifications: reportedNotices(lint, options).map(notification),
          },
        ],
        results: reportedFindings(lint, options).map((f) => result(f, ids.indexOf(f.ruleId))),
        columnKind: 'utf16CodeUnits' as const,
      },
    ],
  };
}

export function formatSarif(lint: LintResult, options: ReportOptions = {}): string {
  return `${JSON.stringify(sarifLog(lint, options), null, 2)}\n`;
}
