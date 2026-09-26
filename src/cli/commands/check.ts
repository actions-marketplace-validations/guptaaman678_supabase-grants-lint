/**
 * `check` (spec §6.3): lints the migrations and maps the result to an exit code. The linter is
 * imported lazily so that `--help`, `--version` and usage errors never load the parser.
 */
import { UsageError } from '../../errors.js';
import type { LintResult } from '../../lint.js';
import {
  booleanOption,
  choiceOption,
  countOption,
  listOption,
  type OptionSpecs,
  parseCommandArgs,
  stringOption,
} from '../args.js';
import { type Colors, colorEnabled, colors } from '../color.js';
import { ExitCode } from '../exit-codes.js';
import type { Io } from '../io.js';
import { COMMAND_USAGE } from '../usage.js';

export const FORMATS = ['pretty', 'json', 'sarif', 'github'] as const;
export type Format = (typeof FORMATS)[number];

export const CHECK_OPTIONS: OptionSpecs = {
  dir: { type: 'string' },
  config: { type: 'string' },
  since: { type: 'string' },
  schema: { type: 'string', multiple: true },
  format: { type: 'string' },
  'max-warnings': { type: 'string' },
  'strict-parse': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export interface ExitPolicy {
  /** `--max-warnings`; unlimited when omitted. */
  readonly maxWarnings?: number | undefined;
  readonly strictParse: boolean;
}

/**
 * 3 for unparseable SQL under `--strict-parse`; 1 for any error finding or more warnings than
 * `--max-warnings`; otherwise 0.
 */
export function exitCodeFor(result: Pick<LintResult, 'findings'>, policy: ExitPolicy): ExitCode {
  const { findings } = result;
  if (
    policy.strictParse &&
    findings.some((f) => f.ruleId === 'PARSE001' && f.severity === 'error')
  ) {
    return ExitCode.Internal;
  }
  if (findings.some((f) => f.severity === 'error')) return ExitCode.Findings;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  if (policy.maxWarnings !== undefined && warnings > policy.maxWarnings) return ExitCode.Findings;
  return ExitCode.Ok;
}

export async function check(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parseCommandArgs(args, CHECK_OPTIONS, 'check');
  if (booleanOption(values, 'help')) {
    io.stdout(COMMAND_USAGE.check);
    return ExitCode.Ok;
  }
  if (positionals.length > 0) {
    throw new UsageError(
      `check takes no arguments, got "${positionals.join(' ')}". Use --dir <path> for another project.`,
    );
  }
  const format = choiceOption(values, 'format', FORMATS) ?? 'pretty';
  if (format !== 'pretty') {
    throw new UsageError(`--format ${format} is not available in this build yet.`);
  }
  const maxWarnings = countOption(values, 'max-warnings');
  const strictParse = booleanOption(values, 'strict-parse');
  const quiet = booleanOption(values, 'quiet');
  const dir = stringOption(values, 'dir');
  const configFile = stringOption(values, 'config');
  const since = stringOption(values, 'since');
  const schemas = listOption(values, 'schema');

  const { lint } = await import('../../lint.js');
  const result = await lint({
    cwd: io.cwd,
    ...(dir === undefined ? {} : { dir }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(since === undefined ? {} : { since }),
    ...(schemas === undefined ? {} : { schemas }),
    strictParse,
  });
  const c = colors(
    colorEnabled({ isTTY: io.isTTY, env: io.env, noColor: booleanOption(values, 'no-color') }),
  );
  io.stdout(formatText(result, c, quiet));
  return exitCodeFor(result, { maxWarnings, strictParse });
}

const LABELS = { error: 'error', warn: 'warn', info: 'info' } as const;

/** Plain text, grouped by file. */
export function formatText(result: LintResult, c: Colors, quiet: boolean): string {
  const findings = quiet ? result.findings.filter((f) => f.severity === 'error') : result.findings;
  const out: string[] = [];
  let file: string | undefined;
  for (const finding of findings) {
    if (finding.file !== file) {
      if (file !== undefined) out.push('');
      file = finding.file;
      out.push(c.bold(file));
    }
    const label = LABELS[finding.severity];
    const severity =
      finding.severity === 'error'
        ? c.red(label)
        : finding.severity === 'warn'
          ? c.yellow(label)
          : c.cyan(label);
    out.push(
      `  ${`${String(finding.line)}:${String(finding.column)}`.padEnd(6)} ${severity}  ${finding.ruleId}  ${finding.message}`,
    );
    if (finding.fix !== undefined) out.push(`         ${c.dim('fix')}   ${finding.fix}`);
    out.push(`         ${c.dim('docs')}  ${finding.docsUrl}`);
  }
  if (!quiet) {
    for (const notice of result.notices) {
      const where =
        notice.file === undefined
          ? ''
          : `${notice.file}${notice.line === undefined ? '' : `:${String(notice.line)}`}: `;
      out.push(`${out.length === 0 ? '' : '\n'}${c.dim('notice')}  ${where}${notice.message}`);
    }
  }
  const { errors, warnings, files, relations, durationMs } = result.summary;
  const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`;
  const summary =
    `${plural(errors, 'error')}, ${plural(warnings, 'warning')}  ` +
    `(${plural(files, 'file')}, ${plural(relations, 'relation')}, ${(durationMs / 1000).toFixed(1)}s)`;
  if (out.length > 0) out.push('');
  out.push(errors > 0 ? c.red(summary) : warnings > 0 ? c.yellow(summary) : summary);
  return `${out.join('\n')}\n`;
}
