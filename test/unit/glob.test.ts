import { describe, expect, it } from 'vitest';
import { globToRegExp, hasGlobMagic } from '../../src/load/glob.js';

describe('hasGlobMagic', () => {
  it.each([
    ['supabase/migrations', false],
    ['supabase/migrations/*.sql', true],
    ['db/?_a.sql', true],
    ['db/[ab]', true],
    ['{a,b}', true],
  ])('%s -> %s', (pattern, magic) => {
    expect(hasGlobMagic(pattern)).toBe(magic);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['*.sql', '1_a.sql', true],
    ['*.sql', 'dir/1_a.sql', false],
    ['*.sql', '1_a.sqlx', false],
    ['?_a.sql', '1_a.sql', true],
    ['?_a.sql', '12_a.sql', false],
    ['**/*.sql', '1_a.sql', true],
    ['**/*.sql', 'a/b/1_a.sql', true],
    ['a/**', 'a/b/c.sql', true],
    ['a/**/b/*.sql', 'a/b/1.sql', true],
    ['a/**/b/*.sql', 'a/x/y/b/1.sql', true],
    ['a/**/b/*.sql', 'a/x/y/c/1.sql', false],
    ['x**.sql', 'xy.sql', true],
    ['x**.sql', 'x/y.sql', false],
    ['[0-9]_*.sql', '7_a.sql', true],
    ['[0-9]_*.sql', 'a_a.sql', false],
    ['[!0-9]*.sql', 'a.sql', true],
    ['[!0-9]*.sql', '1.sql', false],
    ['[^0-9]*.sql', 'a.sql', true],
    ['[]x.sql', '[]x.sql', true],
    ['{todos,orders}.sql', 'orders.sql', true],
    ['{todos,orders}.sql', 'profiles.sql', false],
    ['a+b(1)|$.sql', 'a+b(1)|$.sql', true],
    ['a}.sql', 'a}.sql', true],
    ['a,b.sql', 'a,b.sql', true],
  ])('%s matches %s -> %s', (pattern, input, expected) => {
    expect(globToRegExp(pattern).test(input)).toBe(expected);
  });

  it('keeps / out of negated classes', () => {
    expect(globToRegExp('a[!x]b').test('a/b')).toBe(false);
  });
});
