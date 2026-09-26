/**
 * Command-line parsing (spec §6.3) on top of `node:util` `parseArgs`, which is used only to
 * tokenise: this module checks every token itself so that an unknown flag, a missing value or a
 * value given to a switch is a usage error (exit 2) with a "did you mean" suggestion.
 */
import { parseArgs } from 'node:util';
import { suggest } from '../config/validate.js';
import { UsageError } from '../errors.js';

export interface OptionSpec {
  readonly type: 'string' | 'boolean';
  /** A string option that may be repeated (`--schema a --schema b`). */
  readonly multiple?: boolean;
  readonly short?: string;
}

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

export type OptionValues = Record<string, string | string[] | boolean | undefined>;

export interface ParsedArgs {
  readonly values: OptionValues;
  readonly positionals: string[];
}

function flagNames(specs: OptionSpecs): string[] {
  return Object.entries(specs).flatMap(([name, spec]) => [
    `--${name}`,
    ...(spec.short === undefined ? [] : [`-${spec.short}`]),
  ]);
}

function didYouMean(input: string, candidates: readonly string[]): string {
  const match = suggest(input, candidates);
  return match === undefined ? '' : ` Did you mean "${match}"?`;
}

/** Parses `args` against `specs`. `where` names the command in messages (`check`). */
export function parseCommandArgs(
  args: readonly string[],
  specs: OptionSpecs,
  where: string,
): ParsedArgs {
  const { tokens } = parseArgs({
    args: [...args],
    options: Object.fromEntries(
      Object.entries(specs).map(([name, spec]) => [
        name,
        { type: spec.type, ...(spec.short === undefined ? {} : { short: spec.short }) },
      ]),
    ),
    allowPositionals: true,
    strict: false,
    tokens: true,
  });

  const values: OptionValues = {};
  const positionals: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'positional') {
      positionals.push(token.value);
      continue;
    }
    if (token.kind !== 'option') continue;
    // `parseArgs` names a known short option by its long name.
    const { name } = token;
    const spec = specs[name];
    if (spec === undefined) {
      throw new UsageError(
        `Unknown option ${token.rawName} for ${where}.${didYouMean(token.rawName, flagNames(specs))}`,
      );
    }
    if (spec.type === 'boolean') {
      if (token.value !== undefined) {
        throw new UsageError(`Option ${token.rawName} does not take a value.`);
      }
      values[name] = true;
      continue;
    }
    // A missing value, or a flag where the value should be (`--format --quiet`).
    if (token.value === undefined || (!token.inlineValue && token.value.startsWith('-'))) {
      throw new UsageError(`Option ${token.rawName} needs a value.`);
    }
    if (spec.multiple === true) {
      const previous = values[name];
      values[name] = [...(Array.isArray(previous) ? previous : []), token.value];
    } else if (values[name] !== undefined) {
      throw new UsageError(`Option ${token.rawName} was given more than once.`);
    } else {
      values[name] = token.value;
    }
  }
  return { values, positionals };
}

/** A string option's value, if it was given. */
export function stringOption(values: OptionValues, name: string): string | undefined {
  const value = values[name];
  return typeof value === 'string' ? value : undefined;
}

/** A repeatable string option's values, if any were given. */
export function listOption(values: OptionValues, name: string): string[] | undefined {
  const value = values[name];
  return Array.isArray(value) ? value : undefined;
}

export function booleanOption(values: OptionValues, name: string): boolean {
  return values[name] === true;
}

/** One of `allowed`, or a usage error naming them. */
export function choiceOption<T extends string>(
  values: OptionValues,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = stringOption(values, name);
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new UsageError(
    `Option --${name} must be one of ${allowed.join(', ')}, got "${value}".${didYouMean(value, allowed)}`,
  );
}

/** A whole number of at least 0, or a usage error. */
export function countOption(values: OptionValues, name: string): number | undefined {
  const value = stringOption(values, name);
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value)) {
    throw new UsageError(`Option --${name} must be a whole number of at least 0, got "${value}".`);
  }
  return Number(value);
}

/** The known command closest to `input`, for "Unknown command" messages. */
export function suggestCommand(input: string, commands: readonly string[]): string {
  return didYouMean(input, commands);
}
