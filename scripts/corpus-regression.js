// Pinned corpus regression (T7.5): fetches each public repository listed in
// `test/corpus/pins.json` at its pinned commit (only its `supabase/` folder), runs the built CLI
// with the options recorded in the pins file, and compares the files replayed and the finding
// count per rule with the expected values. Any difference, fetch failure or internal error (exit 3)
// fails the run. Needs `dist/` (`npm run build` first) and network access to github.com.
// Runs weekly and before releases (see `.github/workflows/corpus.yml`), never on ordinary PRs.
//
//   node scripts/corpus-regression.js            compare with the expected counts
//   node scripts/corpus-regression.js --update   rewrite the expected counts from this run
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const pinsPath = path.join(root, 'test', 'corpus', 'pins.json');
const cli = path.join(root, 'dist', 'cli', 'index.js');
const update = process.argv.includes('--update');

const pinsFile = JSON.parse(readFileSync(pinsPath, 'utf8'));
const tmp = mkdtempSync(path.join(os.tmpdir(), 'grants-lint-corpus-'));
const configPath = path.join(tmp, 'config.json');
writeFileSync(configPath, JSON.stringify(pinsFile.config) + '\n');

function git(args, cwd) {
  execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function fetchPin(pin, dir) {
  git(['init', '-q', dir]);
  git(['remote', 'add', 'origin', pin.repo], dir);
  git(['sparse-checkout', 'set', '--cone', 'supabase'], dir);
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', pin.sha], dir);
  git(['checkout', '-q', 'FETCH_HEAD'], dir);
}

function countByRule(findings) {
  const counts = {};
  for (const f of findings) counts[f.ruleId] = (counts[f.ruleId] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function describe(expected, actual) {
  const rules = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return rules
    .filter((r) => expected[r] !== actual[r])
    .map((r) => `${r} expected ${String(expected[r] ?? 0)}, got ${String(actual[r] ?? 0)}`);
}

let failures = 0;
try {
  for (const [i, pin] of pinsFile.pins.entries()) {
    const label = `[${String(i + 1)}/${String(pinsFile.pins.length)}] ${pin.repo}@${pin.sha.slice(0, 12)}`;
    const dir = path.join(tmp, String(i));
    try {
      fetchPin(pin, dir);
    } catch (e) {
      failures++;
      process.stdout.write(`${label}  FAIL fetch: ${String(e.stderr ?? e.message).trim()}\n`);
      continue;
    }
    const run = spawnSync(process.execPath, [cli, ...pinsFile.args, '--config', configPath], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    rmSync(dir, { recursive: true, force: true });
    if (run.status !== 0 && run.status !== 1) {
      failures++;
      process.stdout.write(`${label}  FAIL exit ${String(run.status)}: ${run.stderr.trim()}\n`);
      continue;
    }
    const report = JSON.parse(run.stdout);
    const actual = { files: report.summary.files, findings: countByRule(report.findings) };
    if (update) {
      pin.expected = actual;
      process.stdout.write(`${label}  updated: ${JSON.stringify(actual)}\n`);
      continue;
    }
    const diffs = describe(pin.expected.findings, actual.findings);
    if (pin.expected.files !== actual.files) {
      diffs.unshift(`files expected ${String(pin.expected.files)}, got ${String(actual.files)}`);
    }
    if (diffs.length > 0) {
      failures++;
      process.stdout.write(`${label}  FAIL ${diffs.join('; ')}\n`);
    } else {
      const total = Object.values(actual.findings).reduce((a, b) => a + b, 0);
      process.stdout.write(
        `${label}  ok (${String(actual.files)} files, ${String(total)} findings)\n`,
      );
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (update && failures === 0) writeFileSync(pinsPath, JSON.stringify(pinsFile, null, 2) + '\n');
process.stdout.write(
  failures === 0
    ? `PASS: ${String(pinsFile.pins.length)} pinned projects ${update ? 'recorded' : 'match'}\n`
    : `FAIL: ${String(failures)} of ${String(pinsFile.pins.length)} pinned projects\n`,
);
process.exitCode = failures === 0 ? 0 : 1;
