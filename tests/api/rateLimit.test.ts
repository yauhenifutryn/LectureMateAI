import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({ hitRateLimit: vi.fn(), isConfigured: vi.fn(() => true) }));
vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

import { RateLimitError, enforceRateLimit } from '../../api/_lib/rateLimit';

const req: any = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: {} };

describe('enforceRateLimit', () => {
  beforeEach(() => {
    storeMock.hitRateLimit.mockReset();
    storeMock.isConfigured.mockReturnValue(true);
  });

  it('passes when under the limit', async () => {
    storeMock.hitRateLimit.mockResolvedValueOnce({ allowed: true, count: 1 });
    await expect(enforceRateLimit(req, 'admin-verify', 5)).resolves.toBeUndefined();
  });

  it('throws RateLimitError when over the limit', async () => {
    storeMock.hitRateLimit.mockResolvedValueOnce({ allowed: false, count: 6 });
    await expect(enforceRateLimit(req, 'admin-verify', 5)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('allows login via the in-memory fallback when the store is unreachable', async () => {
    storeMock.hitRateLimit.mockRejectedValueOnce(new TypeError('fetch failed'));
    const outageReq: any = { headers: { 'x-forwarded-for': '9.9.9.9' }, socket: {} };
    await expect(enforceRateLimit(outageReq, 'admin-verify', 5)).resolves.toBeUndefined();
  });

  it('still throttles brute force via the in-memory fallback during a store outage', async () => {
    storeMock.hitRateLimit.mockRejectedValue(new TypeError('fetch failed'));
    const attackReq: any = { headers: { 'x-forwarded-for': '8.8.8.8' }, socket: {} };
    // limit = 2: first two attempts allowed, the third is throttled even though the store is down.
    await expect(enforceRateLimit(attackReq, 'admin-verify', 2)).resolves.toBeUndefined();
    await expect(enforceRateLimit(attackReq, 'admin-verify', 2)).resolves.toBeUndefined();
    await expect(enforceRateLimit(attackReq, 'admin-verify', 2)).rejects.toBeInstanceOf(RateLimitError);
  });
});
