/**
 * Terminal colour (spec §6.3): on only when the stream is a TTY, `NO_COLOR` is unset or empty
 * (https://no-color.org) and `--no-color` was not given. Plain ANSI codes, no dependency (G5).
 */

export interface Colors {
  readonly enabled: boolean;
  red(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
}

export interface ColorInput {
  readonly isTTY: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** `--no-color`. */
  readonly noColor: boolean;
}

export function colorEnabled({ isTTY, env, noColor }: ColorInput): boolean {
  const NO_COLOR = env.NO_COLOR;
  return isTTY && !noColor && (NO_COLOR === undefined || NO_COLOR === '');
}

function wrap(open: number, close: number): (text: string) => string {
  return (text) => `\u001b[${String(open)}m${text}\u001b[${String(close)}m`;
}

const plain = (text: string): string => text;

export function colors(enabled: boolean): Colors {
  if (!enabled) {
    return { enabled, red: plain, yellow: plain, cyan: plain, dim: plain, bold: plain };
  }
  return {
    enabled,
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}
