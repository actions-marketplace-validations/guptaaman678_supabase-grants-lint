import { ExitCode } from './cli/exit-codes.js';

/** A problem with the user's input (flags, config, paths). The CLI exits with code 2. */
export class UsageError extends Error {
  readonly exitCode = ExitCode.Usage;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface ConfigIssue {
  /** Where in the config the problem is, e.g. `since` or `ignore[0].reason`. */
  readonly key: string;
  readonly message: string;
}

/** An invalid or unreadable config. `source` is the file (or `command line`) it came from. */
export class ConfigError extends UsageError {
  constructor(
    readonly source: string,
    readonly issues: readonly ConfigIssue[],
  ) {
    const [only, ...rest] = issues;
    super(
      only !== undefined && rest.length === 0
        ? `Invalid config in ${source}: ${formatIssue(only)}`
        : `Invalid config in ${source}:\n${issues.map((i) => `  - ${formatIssue(i)}`).join('\n')}`,
    );
    this.name = 'ConfigError';
  }
}

function formatIssue(issue: ConfigIssue): string {
  return issue.key === '' ? issue.message : `"${issue.key}" ${issue.message}`;
}
