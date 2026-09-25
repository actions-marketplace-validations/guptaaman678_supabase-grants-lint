#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { version } from '../version.js';
import { ExitCode } from './exit-codes.js';
import { usage } from './usage.js';

const USAGE = usage();

export function run(argv: readonly string[]): ExitCode {
  let values: { version?: boolean; help?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: {
        version: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return ExitCode.Usage;
  }

  if (values.version) {
    process.stdout.write(`${version}\n`);
    return ExitCode.Ok;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(USAGE);
    return ExitCode.Ok;
  }

  process.stderr.write(`Unknown command: ${positionals[0] ?? ''}\n\n${USAGE}`);
  return ExitCode.Usage;
}

process.exitCode = run(process.argv.slice(2));
