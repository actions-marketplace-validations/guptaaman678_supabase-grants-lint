import { RULE_IDS, type RuleId } from '../config/defaults.js';
import { suggest } from '../config/validate.js';
import { UsageError } from '../errors.js';
import type { SourceLocation } from './ir.js';

export const DISABLE_NEXT_LINE = 'grants-lint-disable-next-line';

/** A SQL comment found by the scanner (comments are not part of the AST). */
export interface SqlComment extends SourceLocation {
  /** The comment including its `--` or `/* *\/` delimiters. */
  readonly text: string;
  /** Line the comment ends on (differs from `line` for multi-line block comments). */
  readonly endLine: number;
}

/** `-- grants-lint-disable-next-line GL002, GL003: <reason>` */
export interface Suppression extends SourceLocation {
  readonly rules: readonly RuleId[];
  readonly reason: string;
  /** Findings anchored on this line are suppressed. */
  readonly targetLine: number;
}

/** A malformed suppression comment. Any of these is a usage error (exit 2). */
export interface SuppressionProblem extends SourceLocation {
  readonly message: string;
}

export interface SuppressionScan {
  readonly suppressions: Suppression[];
  readonly problems: SuppressionProblem[];
}

const EXAMPLE = `-- ${DISABLE_NEXT_LINE} GL002: <reason>`;

function commentBody(text: string): string {
  if (text.startsWith('--')) return text.slice(2).trim();
  return text.replace(/^\/\*/, '').replace(/\*\/$/, '').trim();
}

/** Reads `grants-lint-disable-next-line` directives from the comments of one file. */
export function scanSuppressions(comments: readonly SqlComment[]): SuppressionScan {
  const suppressions: Suppression[] = [];
  const problems: SuppressionProblem[] = [];

  for (const comment of comments) {
    const body = commentBody(comment.text);
    if (!body.startsWith(DISABLE_NEXT_LINE)) continue;
    const rest = body.slice(DISABLE_NEXT_LINE.length);
    // `grants-lint-disable-next-lines` or similar is not the directive.
    if (rest !== '' && !/^[\s:]/.test(rest)) continue;

    const location = { file: comment.file, line: comment.line, column: comment.column };
    const problem = (message: string): void => {
      problems.push({ ...location, message: `${message}. Expected: ${EXAMPLE}` });
    };

    const colon = rest.indexOf(':');
    const ruleText = (colon === -1 ? rest : rest.slice(0, colon)).trim();
    const reason = colon === -1 ? '' : rest.slice(colon + 1).trim();
    const words = ruleText.split(/[\s,]+/).filter((word) => word !== '');

    if (words.length === 0) {
      problem(`${DISABLE_NEXT_LINE} must name the rule it disables`);
      continue;
    }
    const rules: RuleId[] = [];
    let unknown = false;
    for (const word of words) {
      const id = word.toUpperCase();
      if ((RULE_IDS as readonly string[]).includes(id)) {
        if (!rules.includes(id as RuleId)) rules.push(id as RuleId);
        continue;
      }
      const hint = suggest(id, RULE_IDS);
      problem(`Unknown rule "${word}"${hint === undefined ? '' : ` (did you mean ${hint}?)`}`);
      unknown = true;
    }
    if (unknown) continue;
    if (reason === '') {
      problem(`${DISABLE_NEXT_LINE} ${rules.join(', ')} needs a reason after a colon`);
      continue;
    }
    suppressions.push({ ...location, rules, reason, targetLine: comment.endLine + 1 });
  }

  return { suppressions, problems };
}

/** One usage error (exit 2) listing every malformed suppression comment. */
export function suppressionError(problems: readonly SuppressionProblem[]): UsageError {
  const lines = problems.map(
    (p) => `${p.file}:${String(p.line)}:${String(p.column)}: ${p.message}`,
  );
  return new UsageError(
    lines.length === 1
      ? `Invalid suppression comment at ${lines.join('')}`
      : `Invalid suppression comments:\n${lines.map((line) => `  - ${line}`).join('\n')}`,
  );
}
