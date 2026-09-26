/**
 * The README demo (spec T8.3): `media/demo.tape` runs `check` on `media/demo`, appends
 * `media/demo/grants.sql` to the migration the tape names, and runs `check` again. This keeps the
 * three in step: the first run has three findings whose fixes are exactly `grants.sql`, and the
 * second run is clean.
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import type { JsonReport } from '../../src/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEMO = path.join(ROOT, 'media/demo');
const tape = readFileSync(path.join(ROOT, 'media/demo.tape'), 'utf8');
const grants = readFileSync(path.join(DEMO, 'grants.sql'), 'utf8');
const temp = mkdtempSync(path.join(tmpdir(), 'grants-lint-demo-'));

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

async function check(dir: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd: dir,
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  const code = await run(['check', '--format', 'json'], io);
  expect(err.join('')).toBe('');
  return { code, report: JSON.parse(out.join('')) as JsonReport };
}

/** The lines the tape types, in order. */
const typed = [...tape.matchAll(/^Type (?:"(.*)"|`(.*)`)$/gm)].map((m) => m[1] ?? m[2] ?? '');

it('renders media/demo.gif from media/demo', () => {
  expect(tape).toMatch(/^Output media\/demo\.gif$/m);
  expect(typed[0]).toContain('cp -R media/demo ');
});

it('runs check, appends grants.sql to the migration, and runs check again', () => {
  const shown = typed.slice(typed.findIndex((line) => line.startsWith('export PS1=')) + 1);
  expect(shown).toEqual([
    'npx supabase-grants-lint check',
    'cat grants.sql >> supabase/migrations/20261002120000_add_todos.sql',
    'npx supabase-grants-lint check',
  ]);
});

it('finds three errors whose fixes are exactly grants.sql', async () => {
  const { code, report } = await check(DEMO);
  expect(code).toBe(1);
  expect(report.findings.map((f) => f.ruleId)).toEqual(['GL001', 'GL004', 'GL003']);
  expect(report.summary).toMatchObject({ errors: 3, warnings: 0, notices: 0 });
  const fixes = report.findings.map((f) => f.fix);
  expect(grants.split('\n').filter((line) => line !== '')).toEqual(fixes);
});

it('is clean once grants.sql is appended', async () => {
  const project = path.join(temp, 'app');
  cpSync(DEMO, project, { recursive: true });
  appendFileSync(path.join(project, 'supabase/migrations/20261002120000_add_todos.sql'), grants);
  const { code, report } = await check(project);
  expect(code).toBe(0);
  expect(report.findings).toEqual([]);
  expect(report.summary).toMatchObject({ errors: 0, warnings: 0, notices: 0 });
});
