import { beforeEach, describe, expect, it, vi } from 'vitest';

const accessMocks = vi.hoisted(() => ({
  recordDemoValidation: vi.fn(),
  validateDemoCode: vi.fn()
}));

const storeMock = vi.hoisted(() => ({
  hitRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
  isConfigured: vi.fn(() => true)
}));

vi.mock('../../api/_lib/access', () => ({
  recordDemoValidation: accessMocks.recordDemoValidation,
  validateDemoCode: accessMocks.validateDemoCode,
  AccessError: class AccessError extends Error {
    status = 401;
    code = 'unauthorized';
  }
}));

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

import handler from '../../api/demo/validate';

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('demo validate handler', () => {
  beforeEach(() => {
    accessMocks.recordDemoValidation.mockReset();
    accessMocks.validateDemoCode.mockReset();
    process.env.ADMIN_PASSWORD = 'ADMIN123';
  });

  it('accepts admin password as master demo key', async () => {
    const req = {
      method: 'POST',
      body: { code: 'ADMIN123' }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ mode: 'admin' });
    expect(accessMocks.validateDemoCode).not.toHaveBeenCalled();
  });

  it('returns remaining uses for valid demo code', async () => {
    accessMocks.validateDemoCode.mockResolvedValueOnce(3);
    const req = {
      method: 'POST',
      body: { code: 'demo-1' }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ remaining: 3, mode: 'demo' });
    expect(accessMocks.recordDemoValidation).toHaveBeenCalledWith('demo-1');
  });
});
