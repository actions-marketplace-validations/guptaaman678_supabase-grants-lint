/**
 * PARSE001 unparseable-statement (spec §6.1, §6.2): a statement the parser rejected, which the
 * replay skipped, and a migration file without a numeric version prefix, which discovery orders
 * after every versioned file. Info by default; `--strict-parse` makes it an error (see `runRules`).
 * Every file is checked, enforced or not: a skipped statement changes the state later files see.
 */
import type { Rule, RuleFinding } from './types.js';

export const PARSE001: Rule = {
  id: 'PARSE001',
  name: 'unparseable-statement',
  defaultSeverity: 'info',
  docs: 'A statement could not be parsed and was skipped, or a migration file name has no version prefix.',
  check(ctx) {
    const unversioned = ctx.discovery.map((notice): RuleFinding => ({
      at: { file: notice.file, line: 1, column: 1 },
      message:
        `${notice.message}. The rules that check new relations (GL001 to GL006, GL008) check ` +
        'it only when since is "none".',
    }));
    const skipped = ctx.files.flatMap((file) =>
      file.events.flatMap((event): RuleFinding[] =>
        event.kind === 'skipped' && event.reason === 'unparseable'
          ? [
              {
                at: event.at,
                message:
                  `The replay skipped this statement because it could not be parsed ` +
                  `(${event.message}), so any grant, table or policy in it is not checked. ` +
                  'If Postgres accepts it, please report it as a bug.',
              },
            ]
          : [],
      ),
    );
    return [...unversioned, ...skipped];
  },
};
