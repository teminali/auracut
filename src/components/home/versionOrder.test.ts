/*
  Ordering versions, which decides what the rollback menu offers.

  String comparison is wrong the moment a number reaches double figures:
  "1.10.0" sorts BEFORE "1.9.0", so a user on 1.10 would be offered a
  "roll back" to something newer than what they are running, and the
  sideload would happily install it.
*/
import { describe, it, expect } from 'vitest';
import { compare } from './VersionFooter';

describe('comparing versions', () => {
  it('orders by number, not by string', () => {
    expect(compare('1.10.0', '1.9.0')).toBe(1);
    expect(compare('1.9.0', '1.10.0')).toBe(-1);
  });

  it('calls equal versions equal', () => {
    expect(compare('1.7.0', '1.7.0')).toBe(0);
  });

  it('orders patch, minor and major', () => {
    expect(compare('1.6.3', '1.6.2')).toBe(1);
    expect(compare('1.7.0', '1.6.9')).toBe(1);
    expect(compare('2.0.0', '1.99.99')).toBe(1);
  });

  it('treats a missing part as zero', () => {
    expect(compare('1.7', '1.7.0')).toBe(0);
    expect(compare('1.7', '1.7.1')).toBe(-1);
  });

  it('picks only genuinely older releases for a rollback list', () => {
    const current = '1.7.0';
    const published = ['1.10.0', '1.7.0', '1.6.3', '1.6.2', '1.6.1'];
    const older = published.filter((v) => compare(v, current) < 0);
    expect(older).toEqual(['1.6.3', '1.6.2', '1.6.1']);
    // The newer one is an UPDATE and must not appear as a rollback.
    expect(older).not.toContain('1.10.0');
  });
});
