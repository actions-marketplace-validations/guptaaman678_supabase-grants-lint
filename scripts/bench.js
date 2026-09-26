// Performance benchmark (`npm run bench`): generates synthetic Supabase projects with 100 and
// 500 migration files, then times `check` on the built CLI, one fresh Node process per run, so
// every run includes process start and loading the parser (a cold start). The target is under
// 2 s for 100 files. Needs `dist/` (`npm run bench` builds first).
//
//   node scripts/bench.js [--sizes 100,500] [--runs 7] [--target-ms 2000] [--out result.json] [--keep]
//
// Exits 1 when a run of the smallest size takes longer than the target, or when a run does not
// lint what was generated (wrong file count, unparseable statements, exit code 2 or 3).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'dist', 'cli', 'index.js');

const { values: args } = parseArgs({
  options: {
    sizes: { type: 'string', default: '100,500' },
    runs: { type: 'string', default: '7' },
    'target-ms': { type: 'string', default: '2000' },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});
const sizes = args.sizes.split(',').map(Number);
const runs = Number(args.runs);
const targetMs = Number(args['target-ms']);
if (sizes.some((n) => !Number.isInteger(n) || n < 3) || !(runs >= 1) || !(targetMs > 0)) {
  throw new Error('--sizes takes integers of at least 3, --runs and --target-ms positive numbers');
}
if (!existsSync(cli)) throw new Error(`${cli} not found: run npm run build first`);

// ---------------------------------------------------------------------------------------------
// Generator. Deterministic: file i always gets the same SQL. The first file is a `db pull`
// baseline with the legacy default privileges, the second opts in to explicit grants, and the
// rest cycle through the shapes real migrations take. A few files deliberately miss a grant so
// the rules report findings, as they would on a real history.

const pad = (n) => String(n).padStart(4, '0');
const version = (i) => `20260901${String(i).padStart(6, '0')}`;

const baseline = () => `-- Pulled baseline
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  created_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
create policy "accounts are readable" on public.accounts for select to authenticated using (true);
create policy "own account is writable" on public.accounts for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
`;

const optIn = () => `-- Opt in to explicit Data API grants
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
`;

const table = (name, id, grants) => `create table public.${name} (
  ${id},
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  body text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ${name}_account_id_idx on public.${name} (account_id);
alter table public.${name} enable row level security;

create policy "read own ${name}" on public.${name}
  for select to authenticated using (auth.uid() = account_id);
create policy "insert own ${name}" on public.${name}
  for insert to authenticated with check (auth.uid() = account_id);
create policy "update own ${name}" on public.${name}
  for update to authenticated using (auth.uid() = account_id) with check (auth.uid() = account_id);
create policy "delete own ${name}" on public.${name}
  for delete to authenticated using (auth.uid() = account_id);
${grants}
comment on table public.${name} is 'Synthetic benchmark table';
`;

const templates = [
  // A table with an identity key and the grants it needs.
  (n) =>
    table(
      `widgets_${n}`,
      'id bigint generated always as identity primary key',
      `grant select, insert, update, delete on public.widgets_${n} to authenticated;
grant select, insert, update, delete on public.widgets_${n} to service_role;`,
    ),
  // A serial key: the sequence grant is part of the migration.
  (n) =>
    table(
      `gadgets_${n}`,
      'id bigserial primary key',
      `grant select, insert, update, delete on public.gadgets_${n} to authenticated;
grant select, insert, update, delete on public.gadgets_${n} to service_role;
grant usage on sequence public.gadgets_${n}_id_seq to authenticated;`,
    ),
  // A function, a trigger and a view over an earlier table.
  (n, prev) => `create or replace function public.touch_${n}()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_${n} before update on public.${prev}
  for each row execute function public.touch_${n}();

create view public.open_${n} with (security_invoker = true) as
  select id, account_id, title, created_at from public.${prev} where status = 'open';

grant select on public.open_${n} to authenticated;
grant select on public.open_${n} to service_role;
revoke execute on function public.touch_${n}() from anon, authenticated;
`,
  // Schema changes on an earlier table: columns, a rename of a policy, a data backfill.
  (n, prev) => `alter table public.${prev} add column priority integer not null default 0;
alter table public.${prev} add column due_at timestamptz;
create index ${prev}_due_at_idx on public.${prev} (due_at) where due_at is not null;
alter policy "read own ${prev}" on public.${prev} rename to "owners read ${prev}";
update public.${prev} set priority = 1 where status = 'open';
`,
  // A new table that forgets its grants (GL001, GL002), and a DO block (PARSE002).
  (n) => `create table public.notes_${n} (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  body text not null
);
alter table public.notes_${n} enable row level security;
create policy "read own notes_${n}" on public.notes_${n}
  for select to authenticated using (auth.uid() = account_id);

do $$
begin
  execute 'grant select on public.notes_${n} to authenticated';
end;
$$;
`,
];

/** The SQL of migration `i` (1-based); `created` collects the tables created so far. */
function migration(i, created) {
  if (i === 1) return baseline();
  if (i === 2) return optIn();
  const n = pad(i);
  const kind = (i - 3) % templates.length;
  const prev = created.at(-1) ?? 'accounts';
  const sql = templates[kind](n, prev);
  if (kind === 0) created.push(`widgets_${n}`);
  if (kind === 1) created.push(`gadgets_${n}`);
  return sql;
}

function generate(dir, count) {
  const migrations = path.join(dir, 'supabase', 'migrations');
  mkdirSync(migrations, { recursive: true });
  const created = [];
  for (let i = 1; i <= count; i++) {
    writeFileSync(path.join(migrations, `${version(i)}_step_${pad(i)}.sql`), migration(i, created));
  }
}

// ---------------------------------------------------------------------------------------------
// Timing.

function runOnce(dir, count) {
  const started = process.hrtime.bigint();
  const child = spawnSync(process.execPath, [cli, 'check', '--dir', dir, '--format', 'json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (child.status !== 0 && child.status !== 1) {
    throw new Error(
      `check exited ${String(child.status)} on ${String(count)} files: ${child.stderr}`,
    );
  }
  const report = JSON.parse(child.stdout);
  const unparseable = report.findings.filter((f) => f.ruleId === 'PARSE001').length;
  if (report.summary.files !== count || unparseable > 0) {
    throw new Error(
      `expected ${String(count)} files and no PARSE001, got ${String(report.summary.files)} files and ${String(unparseable)} PARSE001`,
    );
  }
  return { wallMs, lintMs: report.summary.durationMs, summary: report.summary };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const round = (ms) => Math.round(ms);

function machine() {
  let model = '';
  if (process.platform === 'darwin') {
    try {
      model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
    } catch {
      // Not needed for the result.
    }
  }
  const cpus = os.cpus();
  return {
    model,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    memoryGiB: Math.round(os.totalmem() / 2 ** 30),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
  };
}

const work = mkdtempSync(path.join(os.tmpdir(), 'grants-lint-bench-'));
const results = [];
try {
  for (const count of sizes) {
    const dir = path.join(work, `files-${String(count)}`);
    generate(dir, count);
    const first = runOnce(dir, count);
    const timed = Array.from({ length: runs }, () => runOnce(dir, count));
    const walls = timed.map((r) => r.wallMs);
    results.push({
      files: count,
      relations: first.summary.relations,
      findings: { errors: first.summary.errors, warnings: first.summary.warnings },
      runs,
      firstRunMs: round(first.wallMs),
      wallMs: {
        min: round(Math.min(...walls)),
        median: round(median(walls)),
        max: round(Math.max(...walls)),
      },
      lintMedianMs: round(median(timed.map((r) => r.lintMs))),
    });
  }
} finally {
  if (args.keep) process.stdout.write(`Projects kept in ${work}\n`);
  else rmSync(work, { recursive: true, force: true });
}

const smallest = results.reduce((a, b) => (a.files <= b.files ? a : b));
const worst = Math.max(smallest.firstRunMs, smallest.wallMs.max);
const pass = worst < targetMs;
const record = {
  date: new Date().toISOString(),
  command: `node scripts/bench.js --sizes ${sizes.join(',')} --runs ${String(runs)}`,
  machine: machine(),
  target: { files: smallest.files, underMs: targetMs, worstRunMs: worst, pass },
  results,
};
if (args.out) writeFileSync(args.out, `${JSON.stringify(record, null, 2)}\n`);

const m = record.machine;
const lines = [
  `Machine: ${[m.model, m.cpu].filter(Boolean).join(', ')}, ${String(m.cores)} cores, ${String(m.memoryGiB)} GiB, ${m.os}, Node ${m.node}`,
  '',
  '| Files | Relations | First run | Median | Min | Max | Lint only (median) |',
  '|---:|---:|---:|---:|---:|---:|---:|',
  ...results.map(
    (r) =>
      `| ${String(r.files)} | ${String(r.relations)} | ${String(r.firstRunMs)} ms | ${String(r.wallMs.median)} ms | ${String(r.wallMs.min)} ms | ${String(r.wallMs.max)} ms | ${String(r.lintMedianMs)} ms |`,
  ),
  '',
  `Target: ${String(smallest.files)} files under ${String(targetMs)} ms per cold run: ${pass ? 'PASS' : 'FAIL'} (slowest ${String(worst)} ms)`,
];
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = pass ? 0 : 1;
