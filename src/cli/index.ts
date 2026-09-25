#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { version } from '../version.js';
import { ExitCode } from './exit-codes.js';

const USAGE = `Usage: supabase-grants-lint <command> [options]

Commands:
  check     lint migrations for missing Data API grants
  doctor    readiness report for 2026-10-30
  explain   grant timeline for one relation
  init      write a config file and a GitHub workflow

Options:
  --version  print the version
  --help     print this help
`;

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
