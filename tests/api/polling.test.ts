import { describe, expect, it } from 'vitest';
import { isPollingExpired } from '../../api/_lib/polling';

describe('isPollingExpired', () => {
  it('returns false when within timeout', () => {
    expect(isPollingExpired(0, 4000, 5000)).toBe(false);
  });

  it('returns true when timeout exceeded', () => {
    expect(isPollingExpired(0, 6000, 5000)).toBe(true);
  });
});
