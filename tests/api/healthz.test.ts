import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  hitRateLimit: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
  isConfigured: vi.fn(() => true)
}));

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

import handler from '../../api/healthz';

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('healthz handler', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    storeMock.hitRateLimit.mockReset();
    storeMock.hitRateLimit.mockResolvedValue({ allowed: true, count: 1 });
    errorSpy.mockClear();
    delete process.env.STORE_BACKEND;
  });

  afterEach(() => {
    delete process.env.STORE_BACKEND;
  });

  it('returns 200 ok:true and exercises the store when the probe resolves', async () => {
    process.env.STORE_BACKEND = 'firestore';
    const req = { method: 'GET' } as any;
    const res = buildRes();

    await handler(req, res);

    expect(storeMock.hitRateLimit).toHaveBeenCalledWith('healthz-probe', 1_000_000, 60);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, store: 'firestore' });
  });

  it('returns 503 store_unreachable without leaking the raw error when the probe rejects', async () => {
    storeMock.hitRateLimit.mockRejectedValueOnce(new TypeError('fetch failed'));
    const req = { method: 'GET' } as any;
    const res = buildRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: { code: 'store_unreachable', message: 'Data store probe failed.' }
    });

    // The raw error message must never reach the response body.
    const body = JSON.stringify(res.json.mock.calls[0][0]);
    expect(body).not.toContain('fetch failed');
    expect(body).not.toContain('TypeError');

    // But it must be logged server-side.
    expect(errorSpy).toHaveBeenCalled();
    const loggedArgs = errorSpy.mock.calls.map((c) => c.map(String).join(' ')).join(' ');
    expect(loggedArgs).toContain('fetch failed');
  });

  it('returns 405 on a non-GET method', async () => {
    const req = { method: 'POST' } as any;
    const res = buildRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'method_not_allowed', message: 'GET required.' }
    });
    expect(storeMock.hitRateLimit).not.toHaveBeenCalled();
  });
});
