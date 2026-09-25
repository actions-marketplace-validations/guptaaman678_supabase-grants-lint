import { type Dirent, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../errors.js';

const MAGIC = /[*?[{]/;
const REGEX_SPECIAL = /[.+^$()|\\]/;
/** Directories a `**` walk never descends into. */
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

export function hasGlobMagic(pattern: string): boolean {
  return MAGIC.test(pattern);
}

/**
 * Converts a `/`-separated glob to an anchored RegExp. Supports `*`, `?`, `**` as a whole
 * segment, `[abc]`, `[a-z]`, `[!abc]` and `{a,b}`. Wildcards never match `/`.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let braceDepth = 0;
  let i = 0;
  while (i < pattern.length) {
    const c = pattern.charAt(i);
    if (c === '*') {
      if (pattern.charAt(i + 1) === '*') {
        const wholeSegment =
          (i === 0 || pattern.charAt(i - 1) === '/') &&
          (i + 2 === pattern.length || pattern.charAt(i + 2) === '/');
        if (wholeSegment && i + 2 === pattern.length) {
          re += '.*';
          i += 2;
          continue;
        }
        if (wholeSegment) {
          re += '(?:[^/]*/)*';
          i += 3;
          continue;
        }
        re += '[^/]*';
        i += 2;
        continue;
      }
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      let body = close === -1 ? '' : pattern.slice(i + 1, close);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      if (body === '') {
        re += '\\[';
        i += 1;
        continue;
      }
      re += `[${negate ? '^/' : ''}${body.replace(/[\\[^]/g, '\\$&')}]`;
      i = close + 1;
    } else if (c === '{') {
      re += '(?:';
      braceDepth += 1;
      i += 1;
    } else if (c === '}' && braceDepth > 0) {
      re += ')';
      braceDepth -= 1;
      i += 1;
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
      i += 1;
    } else {
      re += REGEX_SPECIAL.test(c) || c === '}' ? `\\${c}` : c;
      i += 1;
    }
  }
  if (braceDepth > 0) throw new UsageError(`Invalid glob "${pattern}": unclosed "{"`);
  return new RegExp(`^${re}$`);
}

/**
 * Returns the absolute paths of files matching `pattern` (`/`-separated, relative to
 * `baseDir` or absolute), in no particular order. Throws a UsageError when the pattern's
 * fixed leading directory does not exist.
 */
export function globFiles(pattern: string, baseDir: string): string[] {
  const segments = pattern.split('/');
  const firstMagic = segments.findIndex((segment) => hasGlobMagic(segment));
  const fixed = segments.slice(0, firstMagic).join('/');
  const rest = segments.slice(firstMagic).join('/');
  const root = path.resolve(baseDir, fixed === '' && firstMagic > 0 ? '/' : fixed || '.');
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(
      `Migrations glob "${pattern}": directory ${fixed || '.'} not found (resolved to ${root})`,
    );
  }
  const matcher = globToRegExp(rest);
  const maxDepth = rest.split('/').includes('**') ? Infinity : rest.split('/').length;
  const out: string[] = [];
  walk(root, '', 1, maxDepth, (rel, abs) => {
    if (matcher.test(rel)) out.push(abs);
  });
  return out;
}

/** A regular file, or a symlink to one. Symlinked directories are not followed. */
export function isFileEntry(entry: Dirent, abs: string): boolean {
  if (entry.isFile()) return true;
  return entry.isSymbolicLink() && statSync(abs, { throwIfNoEntry: false })?.isFile() === true;
}

function walk(
  dir: string,
  relDir: string,
  depth: number,
  maxDepth: number,
  visit: (rel: string, abs: string) => void,
): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (depth < maxDepth && !SKIPPED_DIRS.has(entry.name)) {
        walk(abs, rel, depth + 1, maxDepth, visit);
      }
    } else if (isFileEntry(entry, abs)) {
      visit(rel, abs);
    }
  }
}
