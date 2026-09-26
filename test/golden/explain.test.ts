/**
 * Golden tests for `explain` (spec T4.7): the create, grant, rename, revoke timeline of relations
 * in `test/golden/explain/projects`, compared with `test/golden/explain/<project>.<relation>.txt`.
 * Run with `UPDATE_GOLDEN=1` to rewrite the files after an intentional change, then review the diff.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ExitCode } from '../../src/cli/exit-codes.js';
import type { Io } from '../../src/cli/io.js';
import { run } from '../../src/cli/main.js';
import { explain, formatExplain } from '../../src/explain.js';

const HERE = fileURLToPath(new URL('./explain', import.meta.url));
const PROJECTS = path.join(HERE, 'projects');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const CASES = [
  ['timeline', 'public.todos'],
  ['timeline', 'public.tasks'],
  ['timeline', 'public.orders'],
] as const;

function goldenFile(project: string, relation: string): string {
  return path.join(HERE, `${project}.${relation}.txt`);
}

function cli(project: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    cwd: path.join(PROJECTS, project),
    env: {},
    isTTY: false,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe.each(CASES)('%s %s', (project, relation) => {
  it('matches the golden output', async () => {
    const actual = formatExplain(await explain({ cwd: path.join(PROJECTS, project), relation }));
    const file = goldenFile(project, relation);
    if (UPDATE) writeFileSync(file, actual);
    expect(existsSync(file), `missing golden file ${file}; run with UPDATE_GOLDEN=1`).toBe(true);
    expect(actual).toBe(readFileSync(file, 'utf8'));
  });

  it('is what the CLI prints, with exit 0', async () => {
    const { io, stdout, stderr } = cli(project);
    expect(await run(['explain', relation], io)).toBe(ExitCode.Ok);
    expect(stderr()).toBe('');
    expect(stdout()).toBe(readFileSync(goldenFile(project, relation), 'utf8'));
  });
});

describe('the create-grant-rename-revoke timeline', () => {
  const cwd = path.join(PROJECTS, 'timeline');

  it('follows the relation through its rename, by the old or the new name', async () => {
    const byOld = await explain({ cwd, relation: 'public.todos' });
    const byNew = await explain({ cwd, relation: 'tasks' });
    expect(byOld.timeline).toEqual(byNew.timeline);
    expect(byOld.final).toEqual(byNew.final);
    expect(byOld.names).toEqual(['public.todos', 'public.tasks']);
    expect(byOld.timeline.map((e) => e.action)).toEqual([
      'create',
      'policy',
      'revoke',
      'rename',
      'revoke',
      'grant',
      'revoke',
      'policy',
      'grant',
    ]);
  });

  it('ends with the privileges the replay computed', async () => {
    const { final } = await explain({ cwd, relation: 'public.tasks' });
    expect(final).toHaveLength(1);
    expect(final[0]?.roles).toEqual([
      { role: 'anon', privileges: ['select (columns)'] },
      { role: 'authenticated', privileges: ['select', 'update'] },
      {
        role: 'service_role',
        privileges: [
          'select',
          'insert',
          'update',
          'delete',
          'truncate',
          'references',
          'trigger',
          'maintain',
        ],
      },
      { role: 'PUBLIC', privileges: [] },
    ]);
    expect(final[0]?.policies).toEqual(['"owners read tasks" for select to authenticated']);
  });

  it('exits 2 for an unknown relation and names the closest matches', async () => {
    const { io, stderr } = cli('timeline');
    expect(await run(['explain', 'public.task'], io)).toBe(ExitCode.Usage);
    expect(stderr()).toContain(
      'No migration creates, grants on or adds a policy to public.task. ' +
        'Closest matches: public.tasks, public.todos, public.orders.',
    );
  });
});
