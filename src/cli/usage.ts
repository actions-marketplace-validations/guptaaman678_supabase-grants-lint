import { type Rule, RULES } from '../rules/index.js';

const BIN = 'supabase-grants-lint';

const COMMANDS = `Usage: ${BIN} <command> [options]

Commands:
  check     lint migrations for missing Data API grants
  doctor    readiness report for 2026-10-30
  explain   grant timeline for one relation
  init      write a config file and a GitHub workflow

Options:
  --version  print the version
  --help     print this help (or ${BIN} <command> --help)

Examples:
  ${BIN} check
  ${BIN} check --dir apps/api --format sarif > grants-lint.sarif
  ${BIN} check --since 20261001090000 --max-warnings 0
  ${BIN} doctor
`;

const DISCOVERY_OPTIONS = `  --dir <path>          project directory (default: current directory)
  --config <file>       config file (default: grants-lint.config.json or package.json#grantsLint)
  --since <version>     enforce files after this version; "none" enforces every file
  --schema <name>       schema to check, repeatable (default: public)
  --no-color            plain output (also when NO_COLOR is set or output is not a terminal)`;

/** `<command> --help` text. */
export const COMMAND_USAGE = {
  check: `Usage: ${BIN} check [options]

Replays the migrations and reports tables the Data API cannot reach.

Options:
${DISCOVERY_OPTIONS}
  --format <format>     pretty, json, sarif or github (default: pretty)
  --max-warnings <n>    exit 1 when there are more than n warnings
  --strict-parse        treat unparseable statements as errors (exit 3)
  --quiet               report errors only

Exit codes: 0 no errors, 1 findings over the threshold, 2 usage or config error,
3 internal error or unparseable SQL under --strict-parse.

Examples:
  ${BIN} check
  ${BIN} check --format github
  ${BIN} check --schema public --schema api --since none
`,
  doctor: `Usage: ${BIN} doctor [options]

Readiness report for 2026-10-30: opt-in status, replay trap, history exposure, next steps.

Options:
${DISCOVERY_OPTIONS}

Example:
  ${BIN} doctor
`,
  explain: `Usage: ${BIN} explain <schema.relation> [options]

Prints every migration line that created, granted, revoked, renamed or added a policy to one
relation, and its final privileges per role.

Options:
${DISCOVERY_OPTIONS}

Example:
  ${BIN} explain public.todos
`,
  init: `Usage: ${BIN} init [options]

Writes grants-lint.config.json and .github/workflows/grants-lint.yml.

Options:
  --since <next|version>  enforce from this version; "next" means files after the latest one
  --force                 overwrite existing files
  --no-workflow           write only the config file
  --dir <path>            project directory (default: current directory)

Example:
  ${BIN} init --since next
`,
} as const;

/** The `--help` text: commands, options, examples and one line per rule. */
export function usage(rules: readonly Rule[] = RULES): string {
  if (rules.length === 0) return COMMANDS;
  const width = Math.max(...rules.map((rule) => rule.name.length));
  const lines = rules.map(
    (rule) => `  ${rule.id.padEnd(8)}  ${rule.name.padEnd(width)}  ${rule.defaultSeverity}`,
  );
  return `${COMMANDS}\nRules:\n${lines.join('\n')}\n`;
}
