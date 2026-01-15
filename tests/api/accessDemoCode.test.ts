import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvMock = vi.hoisted(() => ({
  get: vi.fn()
}));

vi.mock('@vercel/kv', () => ({
  kv: kvMock
}));

import { getDemoCodeRemaining, validateDemoCode } from '../../api/_lib/access';

describe('demo code access helpers', () => {
  beforeEach(() => {
    kvMock.get.mockReset();
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns remaining count even if zero', async () => {
    kvMock.get.mockResolvedValueOnce(0);
    const remaining = await getDemoCodeRemaining('code123');
    expect(remaining).toBe(0);
  });

  it('returns null when code is missing', async () => {
    kvMock.get.mockResolvedValueOnce(null);
    const remaining = await getDemoCodeRemaining('missing');
    expect(remaining).toBeNull();
  });

  it('validateDemoCode rejects zero remaining', async () => {
    kvMock.get.mockResolvedValueOnce(0);
    const remaining = await validateDemoCode('code123');
    expect(remaining).toBeNull();
  });
});
