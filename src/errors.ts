import { ExitCode } from './cli/exit-codes.js';

/** A problem with the user's input (flags, config, paths). The CLI exits with code 2. */
export class UsageError extends Error {
  readonly exitCode = ExitCode.Usage;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}
