import { describe, expect, it } from 'vitest';
import { getElapsedSeconds } from '../../utils/time';

describe('getElapsedSeconds', () => {
  it('floors to whole seconds', () => {
    expect(getElapsedSeconds(0, 999)).toBe(0);
    expect(getElapsedSeconds(0, 1000)).toBe(1);
    expect(getElapsedSeconds(0, 1999)).toBe(1);
  });

  it('never returns negative values', () => {
    expect(getElapsedSeconds(2000, 1000)).toBe(0);
  });
});
