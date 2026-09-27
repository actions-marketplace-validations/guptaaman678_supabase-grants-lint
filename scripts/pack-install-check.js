// Packaging check (T6.1): packs the built package with `npm pack`, installs the tarball into a
// throwaway project (not a symlink to `src/` or `dist/`), and runs the installed CLI against the
// `clean` and `errors` e2e fixtures to confirm exit codes and file allowlist. Needs `dist/`
// (`npm run build` first). Runs on Node 22 and 24 in CI (see `.github/workflows/ci.yml`).
//
//   node scripts/pack-install-check.js
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const allowed = new Set([
  'dist/',
  'schema/',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'package.json',
]);

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'grants-lint-pack-'));
try {
  const packOut = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp],
    { cwd: root, encoding: 'utf8' },
  );
  const jsonStart = packOut.indexOf('[');
  const jsonEnd = packOut.lastIndexOf(']');
  const [packInfo] = JSON.parse(packOut.slice(jsonStart, jsonEnd + 1));
  const packedPath = path.join(tmp, packInfo.filename);
  if (!existsSync(packedPath)) fail(`tarball not found at ${packedPath}`);

  const entries = packInfo.files.map((f) => f.path);
  const extra = entries.filter(
    (p) => !allowed.has(p) && ![...allowed].some((a) => a.endsWith('/') && p.startsWith(a)),
  );
  if (extra.length > 0) fail(`tarball contains disallowed entries: ${extra.join(', ')}`);
  process.stdout.write(
    `pack: ${entries.length} entries, ${packInfo.size} bytes packed, ${packInfo.unpackedSize} bytes unpacked\n`,
  );

  execFileSync('npm', ['init', '-y'], { cwd: tmp });
  execFileSync('npm', ['--prefix', tmp, 'install', packedPath]);

  const binPath = path.join(tmp, 'node_modules', 'supabase-grants-lint', 'dist', 'cli', 'index.js');
  if (!existsSync(binPath)) fail(`installed CLI not found at ${binPath}`);

  const clean = path.join(root, 'test', 'e2e', 'projects', 'clean');
  const errors = path.join(root, 'test', 'e2e', 'projects', 'errors');

  const cleanResult = execFileSync('node', [binPath, 'check', '--dir', clean], {
    encoding: 'utf8',
  });
  if (!/0 errors, 0 warnings/.test(cleanResult))
    fail(`clean fixture: unexpected output: ${cleanResult}`);

  let errorsExit = 0;
  try {
    execFileSync('node', [binPath, 'check', '--dir', errors], { encoding: 'utf8' });
  } catch (e) {
    errorsExit = e.status;
  }
  if (errorsExit !== 1) fail(`errors fixture: expected exit 1, got ${errorsExit}`);

  process.stdout.write(
    `PASS: tarball allowlisted, installed, clean fixture 0/0, errors fixture exit 1 (node ${process.version})\n`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
