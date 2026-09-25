/** Process exit codes (spec: CLI contract). */
export const ExitCode = {
  /** No error findings, warnings within `--max-warnings`. */
  Ok: 0,
  /** Findings over the threshold. */
  Findings: 1,
  /** Usage or config error. */
  Usage: 2,
  /** Internal error, or a fatal parse error under `--strict-parse`. */
  Internal: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
