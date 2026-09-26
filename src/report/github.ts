/**
 * GitHub Actions workflow commands (spec §6.3): `::error file=...,line=...,col=...,title=GL001::...`
 * per finding, so the runner turns each into an annotation on the migration line. Escaping follows
 * `@actions/core` (`%`, CR and LF in the message; also `:` and `,` in properties).
 */
import type { LintResult } from '../lint.js';
import type { Severity } from '../rules/types.js';
import { summaryLine } from './pretty.js';
import { type ReportOptions, reportedFindings, reportedNotices } from './select.js';

type Command = 'error' | 'warning' | 'notice';

const COMMANDS: Readonly<Record<Severity, Command>> = {
  error: 'error',
  warn: 'warning',
  info: 'notice',
};

export function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

function command(
  name: Command,
  properties: Readonly<Record<string, string | number | undefined>>,
  message: string,
): string {
  const props = Object.entries(properties)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(',');
  return `::${name}${props === '' ? '' : ` ${props}`}::${escapeData(message)}`;
}

export function formatGithub(result: LintResult, options: ReportOptions = {}): string {
  const lines = reportedFindings(result, options).map((f) => {
    const body = [
      f.message,
      ...(f.fix === undefined ? [] : [`Fix: ${f.fix}`]),
      `Docs: ${f.docsUrl}`,
    ];
    return command(
      COMMANDS[f.severity],
      { file: f.file, line: f.line, col: f.column, title: f.ruleId },
      body.join('\n'),
    );
  });
  for (const n of reportedNotices(result, options)) {
    lines.push(
      command('notice', { file: n.file, line: n.line, col: n.column, title: n.code }, n.message),
    );
  }
  lines.push(summaryLine(result));
  return `${lines.join('\n')}\n`;
}
