import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from '../errors.js';
import { toRelPath } from '../load/discover.js';
import { CONFIG_FILE_NAME, type Config, DEFAULT_CONFIG, PACKAGE_JSON_KEY } from './defaults.js';
import { validateConfig } from './validate.js';

export const COMMAND_LINE_SOURCE = 'command line';
const BOM = String.fromCharCode(0xfeff);

export interface LoadConfigOptions {
  /** Directory relative paths are resolved against. Default: `process.cwd()`. */
  readonly cwd?: string;
  /** Project directory (`--dir`), where `grants-lint.config.json` and `package.json` are read. */
  readonly projectDir?: string;
  /** Explicit config file (`--config`), resolved against `cwd`. */
  readonly configFile?: string;
  /** Values from CLI flags, validated like a config file. */
  readonly overrides?: Record<string, unknown>;
}

export interface LoadedConfig {
  readonly config: Config;
  /** Sources that were applied, lowest precedence first (`relPath`, or `command line`). */
  readonly sources: readonly string[];
}

function isFile(abs: string): boolean {
  return statSync(abs, { throwIfNoEntry: false })?.isFile() ?? false;
}

function readJson(abs: string, label: string): unknown {
  const raw = readFileSync(abs, 'utf8');
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ConfigError(label, [
      { key: '', message: `not valid JSON: ${(error as Error).message}` },
    ]);
  }
}

/**
 * Resolves the effective config. Precedence, highest first: CLI flags, `--config` file,
 * `grants-lint.config.json`, `package.json#grantsLint`, defaults. Each source replaces whole
 * top-level keys of the sources below it (`rules` and `ignore` are not merged across sources).
 * Throws `ConfigError` (exit 2) naming the file and key of any invalid value.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const projectDir = path.resolve(cwd, options.projectDir ?? '.');
  const layers: { source: string; values: Partial<Config> }[] = [];

  const pkgPath = path.join(projectDir, 'package.json');
  if (isFile(pkgPath)) {
    const label = `${toRelPath(cwd, pkgPath)}#${PACKAGE_JSON_KEY}`;
    const pkg = readJson(pkgPath, toRelPath(cwd, pkgPath));
    const section = (pkg as Record<string, unknown> | null)?.[PACKAGE_JSON_KEY];
    if (section !== undefined) {
      layers.push({ source: label, values: validateConfig(section, label) });
    }
  }

  const defaultPath = path.join(projectDir, CONFIG_FILE_NAME);
  if (isFile(defaultPath)) {
    const label = toRelPath(cwd, defaultPath);
    layers.push({ source: label, values: validateConfig(readJson(defaultPath, label), label) });
  }

  if (options.configFile !== undefined) {
    const abs = path.resolve(cwd, options.configFile);
    const label = toRelPath(cwd, abs);
    if (!isFile(abs)) {
      throw new ConfigError(label, [{ key: '', message: 'file not found (from --config)' }]);
    }
    // An explicit file that is also the discovered one is read once, at its higher precedence.
    const existing = layers.findIndex((layer) => layer.source === label);
    if (existing !== -1) layers.splice(existing, 1);
    layers.push({ source: label, values: validateConfig(readJson(abs, label), label) });
  }

  if (options.overrides !== undefined) {
    const values = validateConfig(options.overrides, COMMAND_LINE_SOURCE);
    if (Object.keys(values).length > 0) layers.push({ source: COMMAND_LINE_SOURCE, values });
  }

  let config: Config = DEFAULT_CONFIG;
  for (const layer of layers) config = { ...config, ...layer.values };
  return { config, sources: layers.map((layer) => layer.source) };
}
