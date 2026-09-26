/**
 * `doctor` (spec §6.3): prints the readiness report for 2026-10-30. It informs and does not fail
 * CI: exit 0 whatever it finds, 2 for a usage or config error. The report module is imported
 * lazily, like the linter in `check`, so usage errors never load the parser.
 */
import { UsageError } from '../../errors.js';
import {
  booleanOption,
  listOption,
  type OptionSpecs,
  parseCommandArgs,
  stringOption,
} from '../args.js';
import { colorEnabled, colors } from '../color.js';
import { ExitCode } from '../exit-codes.js';
import type { Io } from '../io.js';
import { COMMAND_USAGE } from '../usage.js';

export const DOCTOR_OPTIONS: OptionSpecs = {
  dir: { type: 'string' },
  config: { type: 'string' },
  since: { type: 'string' },
  schema: { type: 'string', multiple: true },
  'no-color': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export async function doctor(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parseCommandArgs(args, DOCTOR_OPTIONS, 'doctor');
  if (booleanOption(values, 'help')) {
    io.stdout(COMMAND_USAGE.doctor);
    return ExitCode.Ok;
  }
  if (positionals.length > 0) {
    throw new UsageError(
      `doctor takes no arguments, got "${positionals.join(' ')}". Use --dir <path> for another project.`,
    );
  }
  const dir = stringOption(values, 'dir');
  const configFile = stringOption(values, 'config');
  const since = stringOption(values, 'since');
  const schemas = listOption(values, 'schema');

  const { diagnose, formatDoctor } = await import('../../doctor.js');
  const report = await diagnose({
    cwd: io.cwd,
    ...(dir === undefined ? {} : { dir }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(since === undefined ? {} : { since }),
    ...(schemas === undefined ? {} : { schemas }),
  });
  const noColor = booleanOption(values, 'no-color');
  io.stdout(formatDoctor(report, colors(colorEnabled({ isTTY: io.isTTY, env: io.env, noColor }))));
  return ExitCode.Ok;
}
