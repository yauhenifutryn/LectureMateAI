import { describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/blob/delete';
import { validateDemoCode } from '../../api/_lib/access';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn()
}));

vi.mock('../../api/_lib/access', async () => {
  const actual = await vi.importActual('../../api/_lib/access');
  return {
    ...actual,
    validateDemoCode: vi.fn()
  };
});

const createRes = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as VercelResponse & { statusCode: number; body: unknown };
};

const createReq = (overrides: Partial<VercelRequest> = {}) => ({
  method: 'POST',
  headers: {},
  body: {},
  ...overrides
}) as VercelRequest;

describe('blob delete endpoint', () => {
  it('rejects non-POST methods', async () => {
    const req = createReq({ method: 'GET' });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it('rejects missing urls', async () => {
    const req = createReq({ body: {} });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('rejects unauthorized requests', async () => {
    vi.mocked(validateDemoCode).mockResolvedValue(null);
    const req = createReq({ body: { urls: ['https://demo.blob.vercel-storage.com/a'] } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it('allows demo codes and deletes urls', async () => {
    vi.mocked(validateDemoCode).mockResolvedValue(2);
    const req = createReq({
      body: { urls: ['https://demo.blob.vercel-storage.com/a'], demoCode: 'CODE' }
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(cleanupBlobUrls)).toHaveBeenCalledWith([
      'https://demo.blob.vercel-storage.com/a'
    ]);
  });

  it('allows admin token', async () => {
    process.env.ADMIN_PASSWORD = 'secret';
    const req = createReq({
      headers: { authorization: 'Bearer secret' },
      body: { urls: ['https://demo.blob.vercel-storage.com/a'] }
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });
});
