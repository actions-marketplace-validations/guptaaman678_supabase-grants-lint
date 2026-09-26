/**
 * GL000 no-enforcement-baseline (spec §6.2): no `since` resolved (no `--since` flag, no config
 * `since`, no opt-in migration found), so GL001 to GL006 and GL008 checked no file. One finding
 * per run, on the first line of the last migration file; nothing when there are no migrations.
 *
 * The message does not say the project is not opted in (ADR-002 item 2): a project opted in from
 * the dashboard or by the 2026-10-30 change has no opt-in migration either.
 */
import type { Rule } from './types.js';

const MESSAGE =
  'No opt-in migration found, so the rules that check new relations (GL001 to GL006, GL008) ' +
  'checked no file. If your project was opted in from the dashboard, or you are past 2026-10-30, ' +
  'set since to the last migration applied before that (supabase-grants-lint init --since next). ' +
  'Otherwise add the opt-in migration that supabase-grants-lint doctor prints.';

export const GL000: Rule = {
  id: 'GL000',
  name: 'no-enforcement-baseline',
  defaultSeverity: 'warn',
  docs: 'No opt-in migration or since setting was found, so the rules that check new relations did not run.',
  check(ctx) {
    const last = ctx.files.at(-1);
    if (ctx.replay.since.value !== null || last === undefined) return [];
    return [{ at: { file: last.file, line: 1, column: 1 }, message: MESSAGE }];
  },
};
