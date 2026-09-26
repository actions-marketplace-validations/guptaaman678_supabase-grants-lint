/**
 * Line endings and paths across platforms (spec T5.4). Editors on Windows save migrations with
 * CRLF endings. Every rule fixture and every e2e project is copied twice, once with LF and once
 * with CRLF endings, and `check --format json` and `doctor` must print exactly the same for both:
 * same findings, lines, columns, messages, fixes and notices. `--dir` is passed with the
 * platform's separators, so on Windows runners the reported paths must still use `/`.
 *
 * `test/fixtures/GL002/fail/crlf-line-endings` is also committed with CRLF endings
 * (`.gitattributes` keeps them in every checkout) and runs with the other rule fixtures.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import type { JsonReport } from '../../src/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURES = path.join(ROOT, 'test/fixtures');
const CRLF_FIXTURE = path.join(FIXTURES, 'GL002/fail/crlf-line-endings/migrations');

type Eol = 'lf' | 'crlf';

interface Project {
  /** Path under the temporary root, with `/` separators. */
  readonly id: string;
  readonly source: string;
  /** Rule fixtures keep their migrations in `migrations/` and their config in `config.json`. */
  readonly fixture: boolean;
}

function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

const PROJECTS: Project[] = [
  ...subdirs(FIXTURES).flatMap((rule) =>
    subdirs(path.join(FIXTURES, rule)).flatMap((kind) =>
      subdirs(path.join(FIXTURES, rule, kind)).map((name) => ({
        id: `fixtures/${rule}/${kind}/${name}`,
        source: path.join(FIXTURES, rule, kind, name),
        fixture: true,
      })),
    ),
  ),
  ...['apps', 'projects'].flatMap((group) =>
    subdirs(path.join(ROOT, 'test/e2e', group)).map((name) => ({
      id: `${group}/${name}`,
      source: path.join(ROOT, 'test/e2e', group, name),
      fixture: false,
    })),
  ),
];

function withEol(text: string, eol: Eol): string {
  return text.replace(/\r?\n/g, eol === 'crlf' ? '\r\n' : '\n');
}

/** Copies `source` to `dest`, rewriting the line endings of every `.sql` file. */
function copyTree(source: string, dest: string, eol: Eol): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to, eol);
    else if (entry.name.endsWith('.sql'))
      writeFileSync(to, withEol(readFileSync(from, 'utf8'), eol));
    else writeFileSync(to, readFileSync(from));
  }
}

function materialise(root: string, project: Project, eol: Eol): void {
  const dest = path.join(root, eol, ...project.id.split('/'));
  if (!project.fixture) {
    copyTree(project.source, dest, eol);
    return;
  }
  copyTree(path.join(project.source, 'migrations'), path.join(dest, 'migrations'), eol);
  const configFile = path.join(project.source, 'config.json');
  const config = existsSync(configFile)
    ? (JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>)
    : {};
  writeFileSync(
    path.join(dest, 'grants-lint.config.json'),
    JSON.stringify({ ...config, migrations: 'migrations' }),
  );
}

async function cli(cwd: string, args: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd,
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const code = await run(args, io);
  return { code, stdout: out.join(''), stderr: err.join('') };
}

/** The JSON report without the one field that differs between runs. */
function stable(stdout: string): JsonReport {
  const report = JSON.parse(stdout) as JsonReport;
  return { ...report, summary: { ...report.summary, durationMs: 0 } };
}

let tmp: string;
let findingsSeen = 0;

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'grants-lint-crlf-'));
  for (const project of PROJECTS) {
    materialise(tmp, project, 'lf');
    materialise(tmp, project, 'crlf');
  }
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('the committed CRLF fixture', () => {
  it('has CRLF endings on disk and no bare LF', () => {
    const files = readdirSync(CRLF_FIXTURE).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const text = readFileSync(path.join(CRLF_FIXTURE, name), 'utf8');
      expect(text.match(/\r\n/g)?.length ?? 0, name).toBeGreaterThan(5);
      expect(/(?<!\r)\n/.test(text), name).toBe(false);
    }
  });
});

describe('LF and CRLF copies give the same output', () => {
  it('covers every rule fixture and e2e project', () => {
    expect(PROJECTS.filter((p) => p.fixture).length).toBeGreaterThan(100);
    expect(PROJECTS.filter((p) => !p.fixture).length).toBeGreaterThanOrEqual(9);
    expect(PROJECTS.map((p) => p.id)).toContain('fixtures/GL002/fail/crlf-line-endings');
  });

  it.each(PROJECTS.map((p) => [p.id, p] as const))('%s', async (_, project) => {
    const dir = path.join(...project.id.split('/'));
    const crlfSql = readdirSync(path.join(tmp, 'crlf', dir), { recursive: true })
      .map(String)
      .filter((name) => name.endsWith('.sql'));
    expect(crlfSql.length).toBeGreaterThan(0);
    for (const name of crlfSql) {
      const text = readFileSync(path.join(tmp, 'crlf', dir, name), 'utf8');
      if (text.includes('\n')) expect(/(?<!\r)\n/.test(text), name).toBe(false);
    }

    for (const args of [
      ['check', '--format', 'json', '--dir', dir],
      ['doctor', '--dir', dir],
    ]) {
      const lf = await cli(path.join(tmp, 'lf'), args);
      const crlf = await cli(path.join(tmp, 'crlf'), args);
      expect(crlf.code, args[0]).toBe(lf.code);
      expect(crlf.stderr, args[0]).toBe(lf.stderr);
      if (args[0] === 'doctor' || lf.code === 2) {
        expect(crlf.stdout, args[0]).toBe(lf.stdout);
        continue;
      }
      const report = stable(lf.stdout);
      expect(stable(crlf.stdout)).toEqual(report);
      for (const item of [...report.findings, ...report.notices]) {
        if (item.file === undefined) continue;
        expect(item.file.startsWith(`${project.id}/`), item.file).toBe(true);
        expect(item.file, item.file).not.toContain('\\');
      }
      findingsSeen += report.findings.length;
    }
  });

  it('compared a meaningful number of findings', () => {
    expect(findingsSeen).toBeGreaterThan(200);
  });
});
