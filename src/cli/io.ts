/** What a command may touch of the process, so tests can run commands in-process. */
export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether standard output is a terminal. */
  readonly isTTY: boolean;
  stdout(text: string): void;
  stderr(text: string): void;
}

export function processIo(): Io {
  // `isTTY` is undefined, not false, when output is piped; the Node types omit that.
  const stdout: { readonly isTTY?: boolean } = process.stdout;
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: stdout.isTTY ?? false,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}
