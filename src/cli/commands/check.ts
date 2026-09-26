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
import { formatGithub } from '../../report/github.js';
import { formatJson } from '../../report/json.js';
import { formatPretty, type PrettyOptions } from '../../report/pretty.js';
import { formatSarif } from '../../report/sarif.js';
import { colorEnabled, colors } from '../color.js';
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
  const noColor = booleanOption(values, 'no-color');
  io.stdout(
    report(result, format, {
      quiet,
      colors: colors(colorEnabled({ isTTY: io.isTTY, env: io.env, noColor })),
    }),
  );
  return exitCodeFor(result, { maxWarnings, strictParse });
}

/** Renders a lint result in one of the `--format` formats. Only `pretty` uses colour. */
export function report(result: LintResult, format: Format, options: PrettyOptions): string {
  switch (format) {
    case 'pretty':
      return formatPretty(result, options);
    case 'json':
      return formatJson(result, options);
    case 'sarif':
      return formatSarif(result, options);
    case 'github':
      return formatGithub(result, options);
  }
}
