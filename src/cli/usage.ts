import { type Rule, RULES } from '../rules/index.js';

const COMMANDS = `Usage: supabase-grants-lint <command> [options]

Commands:
  check     lint migrations for missing Data API grants
  doctor    readiness report for 2026-10-30
  explain   grant timeline for one relation
  init      write a config file and a GitHub workflow

Options:
  --version  print the version
  --help     print this help
`;

/** The `--help` text: commands, options and one line per rule. */
export function usage(rules: readonly Rule[] = RULES): string {
  if (rules.length === 0) return COMMANDS;
  const width = Math.max(...rules.map((rule) => rule.name.length));
  const lines = rules.map(
    (rule) => `  ${rule.id.padEnd(8)}  ${rule.name.padEnd(width)}  ${rule.defaultSeverity}`,
  );
  return `${COMMANDS}\nRules:\n${lines.join('\n')}\n`;
}
