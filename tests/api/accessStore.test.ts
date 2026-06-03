import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  setDemoCode: vi.fn(),
  getDemoRemaining: vi.fn(),
  consumeDemoCode: vi.fn(),
  appendEvent: vi.fn(),
  isConfigured: vi.fn(() => true)
}));

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

import { storeDemoCode, validateDemoCode } from '../../api/_lib/access';

describe('access via store', () => {
  beforeEach(() =>
    Object.values(storeMock).forEach((f) => typeof f.mockReset === 'function' && f.mockReset())
  );

  it('storeDemoCode normalizes and writes through the store', async () => {
    storeMock.isConfigured.mockReturnValue(true);
    await storeDemoCode('abc', 5);
    expect(storeMock.setDemoCode).toHaveBeenCalledWith('ABC', 5);
  });

  it('validateDemoCode returns null when exhausted', async () => {
    storeMock.isConfigured.mockReturnValue(true);
    storeMock.getDemoRemaining.mockResolvedValueOnce(0);
    expect(await validateDemoCode('ABC')).toBeNull();
  });
});
