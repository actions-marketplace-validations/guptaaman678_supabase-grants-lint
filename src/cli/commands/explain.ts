/**
 * `explain <schema.relation>` (spec §6.3): prints one relation's grant timeline and final
 * privileges. Exit 0, or 2 for a usage or config error and for a relation no migration mentions
 * (with the closest names). The explain module is imported lazily, so usage errors never load the
 * parser.
 */
import { UsageError } from '../../errors.js';
import { booleanOption, listOption, parseCommandArgs, stringOption } from '../args.js';
import { colorEnabled, colors } from '../color.js';
import { ExitCode } from '../exit-codes.js';
import type { Io } from '../io.js';
import { COMMAND_USAGE } from '../usage.js';
import { DOCTOR_OPTIONS } from './doctor.js';

/** The same discovery flags as `doctor`. */
export const EXPLAIN_OPTIONS = DOCTOR_OPTIONS;

export async function explain(args: readonly string[], io: Io): Promise<ExitCode> {
  const { values, positionals } = parseCommandArgs(args, EXPLAIN_OPTIONS, 'explain');
  if (booleanOption(values, 'help')) {
    io.stdout(COMMAND_USAGE.explain);
    return ExitCode.Ok;
  }
  const [relation, ...extra] = positionals;
  if (relation === undefined) {
    throw new UsageError(
      'explain needs a relation, e.g. supabase-grants-lint explain public.todos.',
    );
  }
  if (extra.length > 0) {
    throw new UsageError(`explain takes one relation, got "${positionals.join(' ')}".`);
  }
  const dir = stringOption(values, 'dir');
  const configFile = stringOption(values, 'config');
  const since = stringOption(values, 'since');
  const schemas = listOption(values, 'schema');

  const { explain: explainRelation, formatExplain } = await import('../../explain.js');
  const explanation = await explainRelation({
    relation,
    cwd: io.cwd,
    ...(dir === undefined ? {} : { dir }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(since === undefined ? {} : { since }),
    ...(schemas === undefined ? {} : { schemas }),
  });
  const noColor = booleanOption(values, 'no-color');
  io.stdout(
    formatExplain(explanation, colors(colorEnabled({ isTTY: io.isTTY, env: io.env, noColor }))),
  );
  return ExitCode.Ok;
}
