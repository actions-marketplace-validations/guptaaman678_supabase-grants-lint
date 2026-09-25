import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { version } from '../../src/index.js';
import { ExitCode } from '../../src/cli/exit-codes.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('package', () => {
  it('exports the package.json version', () => {
    expect(version).toBe(pkg.version);
  });

  it('keeps the documented exit codes', () => {
    expect(ExitCode).toEqual({ Ok: 0, Findings: 1, Usage: 2, Internal: 3 });
  });
});
