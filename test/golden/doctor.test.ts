/**
 * Golden tests for `doctor` (spec T4.6): every project in `test/golden/doctor/projects` (opted in,
 * not opted in, replay trap, empty) is diagnosed and compared with `test/golden/doctor/<project>.txt`.
 * Run with `UPDATE_GOLDEN=1` to rewrite the files after an intentional change, then review the diff.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../src/cli/exit-codes.js';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import { lint } from '../../src/lint.js';
import { diagnose, formatDoctor, WIDTH } from '../../src/doctor.js';

const HERE = fileURLToPath(new URL('./doctor', import.meta.url));
const PROJECTS = path.join(HERE, 'projects');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const projects = readdirSync(PROJECTS).sort();

async function doctorText(project: string): Promise<string> {
  return formatDoctor(await diagnose({ cwd: path.join(PROJECTS, project) }));
}

function goldenFile(project: string): string {
  return path.join(HERE, `${project}.txt`);
}

const SECTIONS = ['Opt-in status', 'Replay trap', 'History exposure', 'Next steps'];

describe.each(projects)('%s', (project) => {
  it('matches the golden output', async () => {
    const actual = await doctorText(project);
    const file = goldenFile(project);
    if (UPDATE) writeFileSync(file, actual);
    expect(existsSync(file), `missing golden file ${file}; run with UPDATE_GOLDEN=1`).toBe(true);
    expect(actual).toBe(readFileSync(file, 'utf8'));
  });

  it(`fits ${String(WIDTH)} columns and has the four sections in order`, () => {
    const text = readFileSync(goldenFile(project), 'utf8');
    const lines = text.split('\n');
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(WIDTH);
    const at = SECTIONS.map((title) => lines.indexOf(title));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is what the CLI prints, with exit 0', async () => {
    const out: string[] = [];
    const io: Io = {
      cwd: path.join(PROJECTS, project),
      env: {},
      isTTY: false,
      stdout: (text) => out.push(text),
      stderr: (text) => out.push(text),
    };
    expect(await run(['doctor'], io)).toBe(ExitCode.Ok);
    expect(out.join('')).toBe(readFileSync(goldenFile(project), 'utf8'));
  });
});

describe('golden doctor projects', () => {
  it('cover the four states the task names', async () => {
    const [empty, notOptedIn, optedIn, trap] = await Promise.all(
      ['empty', 'not-opted-in', 'opted-in', 'replay-trap'].map((p) =>
        diagnose({ cwd: path.join(PROJECTS, p) }),
      ),
    );
    expect(empty?.files).toBe(0);
    expect(notOptedIn?.since.value).toBeNull();
    expect(notOptedIn?.unmodelled).toBeGreaterThan(0);
    expect(notOptedIn?.localStack.autoExpose).toBeNull();
    expect(optedIn?.since.source).toBe('auto');
    expect(optedIn?.localStack.autoExpose).toBe(false);
    expect(optedIn?.replayTrap).toBeNull();
    expect(optedIn?.history.unreachable.map((e) => e.relation)).toEqual(['public.orders']);
    expect(trap?.replayTrap?.severity).toBe('error');
    expect(trap?.localStack.autoExpose).toBe(true);
  });

  it('prints the opt-in SQL and the init command when no opt-in migration exists', async () => {
    const text = await doctorText('not-opted-in');
    expect(text).toContain(
      '       alter default privileges for role postgres in schema public\n' +
        '         revoke all on tables from anon, authenticated, service_role;\n' +
        '       alter default privileges for role postgres in schema public\n' +
        '         revoke all on sequences from anon, authenticated, service_role;\n',
    );
    expect(text).toContain('supabase-grants-lint init --since next');
    expect(text).toContain('No opt-in migration found.');
  });

  it('exits 0 where check fails', async () => {
    const cwd = path.join(PROJECTS, 'replay-trap');
    expect((await lint({ cwd })).summary.errors).toBeGreaterThan(0);
  });
});
