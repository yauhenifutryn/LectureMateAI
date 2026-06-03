import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessMocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  AccessError: class AccessError extends Error {
    status = 401;
    code = 'unauthorized';
  }
}));
const rlMocks = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  getRateLimit: vi.fn(() => 5),
  RateLimitError: class RateLimitError extends Error {
    status = 429;
    code = 'rate_limited';
  }
}));

vi.mock('../../api/_lib/access', () => accessMocks);
vi.mock('../../api/_lib/rateLimit', () => rlMocks);

import handler from '../../api/admin/verify';

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('admin verify error handling', () => {
  beforeEach(() => {
    accessMocks.requireAdmin.mockReset();
    rlMocks.enforceRateLimit.mockReset();
  });

  it('never leaks a raw infra error message', async () => {
    rlMocks.enforceRateLimit.mockResolvedValue(undefined);
    accessMocks.requireAdmin.mockImplementation(() => {
      throw new TypeError('fetch failed');
    });
    const res = buildRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer x' } } as any, res);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('fetch failed');
    expect(body.error.code).toBe('storage_unavailable');
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
