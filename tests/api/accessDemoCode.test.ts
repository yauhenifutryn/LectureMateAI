import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  getDemoRemaining: vi.fn(),
  isConfigured: vi.fn(() => true)
}));

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

import { getDemoCodeRemaining, validateDemoCode } from '../../api/_lib/access';

describe('demo code access helpers', () => {
  beforeEach(() => {
    storeMock.getDemoRemaining.mockReset();
    storeMock.isConfigured.mockReturnValue(true);
  });

  it('returns remaining count even if zero', async () => {
    storeMock.getDemoRemaining.mockResolvedValueOnce(0);
    const remaining = await getDemoCodeRemaining('code123');
    expect(remaining).toBe(0);
  });

  it('returns null when code is missing', async () => {
    storeMock.getDemoRemaining.mockResolvedValueOnce(null);
    const remaining = await getDemoCodeRemaining('missing');
    expect(remaining).toBeNull();
  });

  it('validateDemoCode rejects zero remaining', async () => {
    storeMock.getDemoRemaining.mockResolvedValueOnce(0);
    const remaining = await validateDemoCode('code123');
    expect(remaining).toBeNull();
  });
});
