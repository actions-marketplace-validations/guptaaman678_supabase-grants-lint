/**
 * Golden tests for the reporters (spec T4.2 to T4.5): every project in `test/golden/projects` is
 * linted and rendered in every `--format`, and compared with `test/golden/<format>/<project>.txt`.
 * Run with `UPDATE_GOLDEN=1` to rewrite the files after an intentional change, then review the diff.
 *
 * The run time and the package version are normalised so the files do not change between runs or
 * releases. SARIF output is validated against the SARIF 2.1.0 JSON schema, vendored from
 * `@microsoft/jest-sarif` 1.0.0-beta.0 (MIT) as `sarif-schema-2.1.0-rtm.5.json`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ajvDraft04 from 'ajv-draft-04';
import ajvFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { type Format, FORMATS, report } from '../../src/cli/commands/check.js';
import { lint, type LintResult } from '../../src/lint.js';
import { escapeData, escapeProperty } from '../../src/report/github.js';
import { jsonReport } from '../../src/report/json.js';
import { sarifLog } from '../../src/report/sarif.js';
import { RULES } from '../../src/rules/index.js';
import { version } from '../../src/version.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECTS = path.join(HERE, 'projects');
const UPDATE = process.env.UPDATE_GOLDEN === '1';

const projects = readdirSync(PROJECTS).sort();

async function lintProject(project: string): Promise<LintResult> {
  const result = await lint({ cwd: path.join(PROJECTS, project) });
  return { ...result, summary: { ...result.summary, durationMs: 0 } };
}

function normalise(text: string): string {
  return text.replaceAll(version, '<version>');
}

function golden(format: Format, name: string, actual: string): void {
  const file = path.join(HERE, format, `${name}.txt`);
  if (UPDATE) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, actual);
  }
  expect(existsSync(file), `missing golden file ${file}; run with UPDATE_GOLDEN=1`).toBe(true);
  expect(actual).toBe(readFileSync(file, 'utf8'));
}

describe.each(projects)('%s', (project) => {
  it.each(FORMATS)('matches the golden %s output', async (format) => {
    const result = await lintProject(project);
    golden(format, project, normalise(report(result, format, {})));
    if (project === 'mixed') {
      golden(format, `${project}.quiet`, normalise(report(result, format, { quiet: true })));
    }
  });
});

describe('golden projects', () => {
  it('cover every format, both severities with findings, notices and an empty project', async () => {
    const mixed = await lintProject('mixed');
    expect(new Set(mixed.findings.map((f) => f.severity))).toEqual(
      new Set(['error', 'warn', 'info']),
    );
    expect(mixed.notices.length).toBeGreaterThan(0);
    expect(mixed.findings.some((f) => f.fix !== undefined)).toBe(true);
    const baseline = await lintProject('baseline');
    expect(baseline.findings.some((f) => f.fix?.includes('\n') === true)).toBe(true);
    expect(baseline.findings.some((f) => f.file.includes(' '))).toBe(true);
    expect((await lintProject('empty')).summary.files).toBe(0);
    for (const format of FORMATS) {
      for (const project of projects) {
        expect(existsSync(path.join(HERE, format, `${project}.txt`))).toBe(true);
      }
    }
  });
});

describe('pretty', () => {
  it('reproduces the spec example (§6.3) exactly', async () => {
    const base = await lintProject('clean');
    const example: LintResult = {
      ...base,
      findings: [
        {
          ruleId: 'GL001',
          severity: 'error',
          message: 'public.todos is created without a grant to service_role',
          file: 'supabase/migrations/20261002120000_add_todos.sql',
          line: 12,
          column: 1,
          relation: 'public.todos',
          role: 'service_role',
          fix: 'grant select, insert, update, delete on public.todos to service_role;',
          docsUrl:
            'https://github.com/guptaaman678/supabase-grants-lint/blob/v0.1.0/docs/rules/GL001.md',
        },
      ],
      notices: [],
      summary: { ...base.summary, files: 74, relations: 61, errors: 1, durationMs: 400 },
    };
    expect(report(example, 'pretty', {})).toBe(
      [
        'supabase/migrations/20261002120000_add_todos.sql',
        '  12:1  error  GL001  public.todos is created without a grant to service_role',
        '               fix   grant select, insert, update, delete on public.todos to service_role;',
        '               docs  https://github.com/guptaaman678/supabase-grants-lint/blob/v0.1.0/docs/rules/GL001.md',
        '',
        '1 error, 0 warnings  (74 files, 61 relations, 0.4s)',
        '',
      ].join('\n'),
    );
  });

  it('keeps every line of a multi-line fix under the fix column', async () => {
    const text = report(await lintProject('baseline'), 'pretty', {});
    const lines = text.split('\n');
    const at = lines.findIndex((line) => line.includes('fix   alter default privileges'));
    const column = (lines[at] ?? '').indexOf('alter');
    expect(column).toBeGreaterThan(0);
    expect(lines[at + 1]?.indexOf('alter')).toBe(column);
    expect(lines[at + 1]?.slice(0, column).trim()).toBe('');
  });

  it('aligns messages when locations and rule IDs differ in width', async () => {
    const base = await lintProject('mixed');
    const [first, ...rest] = base.findings.filter((f) => f.file.endsWith('_todos.sql'));
    const parse = base.findings.find((f) => f.ruleId === 'PARSE001');
    if (first === undefined || parse === undefined) throw new Error('fixture changed');
    const findings = [
      first,
      ...rest,
      { ...parse, file: first.file, line: 123, column: 45, message: 'M' },
    ];
    const text = report({ ...base, findings, notices: [] }, 'pretty', {});
    const rows = text.split('\n').filter((line) => /^ {2}\d/.test(line));
    expect(rows).toHaveLength(findings.length);
    const starts = rows.map((row, i) => row.indexOf(findings[i]?.message ?? '?'));
    expect(new Set(starts).size).toBe(1);
    expect(rows.at(-1)).toBe('  123:45  info   PARSE001  M');
    const docs = text.split('\n').filter((line) => line.includes('docs  '));
    expect(new Set(docs.map((line) => line.indexOf('docs'))).size).toBe(1);
  });
});

describe('json', () => {
  it('has the documented shape, including the resolved since', async () => {
    const result = await lintProject('mixed');
    const parsed = JSON.parse(report(result, 'json', {})) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'tool',
      'summary',
      'findings',
      'notices',
    ]);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(jsonReport(result))));
    const report_ = jsonReport(result);
    expect(report_.schemaVersion).toBe(1);
    expect(report_.tool).toEqual({ name: 'supabase-grants-lint', version });
    expect(Object.keys(report_.summary)).toEqual([
      'files',
      'relations',
      'errors',
      'warnings',
      'notices',
      'durationMs',
      'since',
    ]);
    expect(report_.summary.since).toMatchObject({ value: '20261001000000', source: 'auto' });
    expect(report_.findings).toEqual(result.findings);
    expect(report_.notices).toEqual(result.notices);
    for (const finding of report_.findings) {
      expect(Object.keys(finding).slice(0, 6)).toEqual([
        'ruleId',
        'severity',
        'message',
        'file',
        'line',
        'column',
      ]);
      expect(Object.keys(finding).at(-1)).toBe('docsUrl');
    }
  });

  it('keeps the full counts under --quiet but lists errors only', async () => {
    const result = await lintProject('mixed');
    const quiet = jsonReport(result, { quiet: true });
    expect(quiet.summary).toEqual(jsonReport(result).summary);
    expect(quiet.findings.length).toBeGreaterThan(0);
    expect(quiet.findings.every((f) => f.severity === 'error')).toBe(true);
    expect(quiet.notices).toEqual([]);
  });
});

describe('sarif', () => {
  const schema = JSON.parse(
    readFileSync(path.join(HERE, 'sarif-schema-2.1.0-rtm.5.json'), 'utf8'),
  ) as object;
  // The schema's `language` pattern is only valid without the `u` flag.
  // Both packages are CommonJS; `.default` is the class and the plugin under Node's ESM interop.
  const ajv = new ajvDraft04.default({ allErrors: true, strict: false, unicodeRegExp: false });
  ajvFormats.default(ajv);
  const validate = ajv.compile(schema);

  it.each(projects)('validates against the SARIF 2.1.0 schema (%s)', async (project) => {
    const result = await lintProject(project);
    for (const quiet of [false, true]) {
      const log = JSON.parse(report(result, 'sarif', { quiet })) as unknown;
      expect(validate(log), JSON.stringify(validate.errors, null, 2)).toBe(true);
    }
  });

  it('rejects a log the schema does not allow (the validator is live)', () => {
    expect(validate({ version: '2.1.0', runs: [{ tool: { driver: {} } }] })).toBe(false);
    expect(validate({ version: '2.0.0', runs: [] })).toBe(false);
  });

  it('points each result at its rule descriptor and the migration line', async () => {
    const result = await lintProject('mixed');
    const [run] = sarifLog(result).runs;
    expect(run?.tool.driver.rules.map((r) => r.id)).toEqual(RULES.map((r) => r.id));
    expect(run?.results).toHaveLength(result.findings.length);
    run?.results.forEach((r, i) => {
      const finding = result.findings[i];
      expect(run.tool.driver.rules[r.ruleIndex]?.id).toBe(r.ruleId);
      expect(r.ruleId).toBe(finding?.ruleId);
      expect(r.locations[0]?.physicalLocation).toEqual({
        artifactLocation: { uri: finding?.file },
        region: { startLine: finding?.line, startColumn: finding?.column },
      });
    });
    expect(run?.invocations[0]?.toolExecutionNotifications).toHaveLength(result.notices.length);
  });

  it('escapes file names into URI references', async () => {
    const [run] = sarifLog(await lintProject('baseline')).runs;
    expect(run?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      'supabase/migrations/20260101000000_remote%20schema.sql',
    );
  });

  it('reports notices with a file, a line or no location as valid notifications', async () => {
    const result = { ...(await lintProject('clean')), notices: PARTIAL_NOTICES };
    const log = sarifLog(result);
    expect(validate(JSON.parse(JSON.stringify(log)))).toBe(true);
    expect(log.runs[0]?.invocations[0]?.toolExecutionNotifications.map((n) => n.locations)).toEqual(
      [
        undefined,
        [{ physicalLocation: { artifactLocation: { uri: 'a.sql' } } }],
        [{ physicalLocation: { artifactLocation: { uri: 'a.sql' }, region: { startLine: 3 } } }],
      ],
    );
  });
});

const PARTIAL_NOTICES = [
  { code: 'unused-ignore', message: 'No location.' },
  { code: 'unused-ignore', message: 'File only.', file: 'a.sql' },
  { code: 'unused-suppression', message: 'File and line.', file: 'a.sql', line: 3 },
] as const;

describe('notices without a full location', () => {
  it('are printed by every format', async () => {
    const result = { ...(await lintProject('clean')), notices: PARTIAL_NOTICES };
    expect(report(result, 'pretty', {})).toContain(
      'notice  No location.\nnotice  a.sql: File only.\nnotice  a.sql:3: File and line.\n',
    );
    expect(report(result, 'github', {})).toContain(
      '::notice title=unused-ignore::No location.\n' +
        '::notice file=a.sql,title=unused-ignore::File only.\n' +
        '::notice file=a.sql,line=3,title=unused-suppression::File and line.\n',
    );
    expect(jsonReport(result).notices).toEqual(PARTIAL_NOTICES);
  });
});

describe('github', () => {
  /** Reverses `@actions/core` escaping. */
  const unescape = (text: string): string =>
    text
      .replace(/%0D/g, '\r')
      .replace(/%0A/g, '\n')
      .replace(/%3A/g, ':')
      .replace(/%2C/g, ',')
      .replace(/%25/g, '%');

  it('escapes like @actions/core', () => {
    expect(escapeData('50% done\r\nnext: a, b')).toBe('50%25 done%0D%0Anext: a, b');
    expect(escapeProperty('a,b:c%\n')).toBe('a%2Cb%3Ac%25%0A');
  });

  it('escapes commas, colons and percent signs in the file property', async () => {
    const base = await lintProject('mixed');
    const withoutFix = base.findings.find((f) => f.ruleId === 'GL005' && f.fix === undefined);
    if (withoutFix === undefined) throw new Error('fixture changed');
    const finding = { ...withoutFix, file: 'db/1_a,b:c%.sql' };
    const text = report({ ...base, findings: [finding], notices: [] }, 'github', {});
    expect(text.split('\n')[0]).toBe(
      `::warning file=db/1_a%2Cb%3Ac%25.sql,line=12,col=1,title=GL005::${escapeData(finding.message)}` +
        `%0ADocs: ${finding.docsUrl}`,
    );
  });

  it('prints one workflow command per finding and notice, then the summary', async () => {
    const result = await lintProject('mixed');
    const lines = report(result, 'github', {}).trimEnd().split('\n');
    const commands = lines.slice(0, -1);
    expect(commands).toHaveLength(result.findings.length + result.notices.length);
    const level = { error: 'error', warn: 'warning', info: 'notice' } as const;
    result.findings.forEach((finding, i) => {
      const match = /^::(\w+) ([^:]*)::(.*)$/.exec(commands[i] ?? '');
      expect(match?.[1]).toBe(level[finding.severity]);
      const props = Object.fromEntries(
        (match?.[2] ?? '').split(',').map((p) => {
          const [key = '', value = ''] = p.split('=');
          return [key, unescape(value)];
        }),
      );
      expect(props).toEqual({
        file: finding.file,
        line: String(finding.line),
        col: String(finding.column),
        title: finding.ruleId,
      });
      const message = unescape(match?.[3] ?? '');
      expect(message.split('\n')[0]).toBe(finding.message);
      if (finding.fix !== undefined) expect(message).toContain(`\nFix: ${finding.fix}\n`);
      expect(message.endsWith(`\nDocs: ${finding.docsUrl}`)).toBe(true);
    });
    for (const command of commands.slice(result.findings.length)) {
      expect(command).toMatch(/^::notice /);
    }
    expect(lines.at(-1)).toMatch(/^\d+ errors?, \d+ warnings? {2}\(/);
  });
});
