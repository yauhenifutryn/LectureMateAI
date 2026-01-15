import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/admin/purge';
import { purgeAllBlobs } from '../../api/_lib/blobAdmin';

vi.mock('../../api/_lib/blobAdmin', () => ({
  purgeAllBlobs: vi.fn()
}));

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

describe('admin purge endpoint', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'secret';
    vi.mocked(purgeAllBlobs).mockReset();
  });

  it('rejects non-POST methods', async () => {
    const req = createReq({ method: 'GET' });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it('rejects missing confirmation', async () => {
    const req = createReq({
      headers: { authorization: 'Bearer secret' },
      body: { confirm: false }
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('purges blobs when confirmed', async () => {
    vi.mocked(purgeAllBlobs).mockResolvedValue(3);
    const req = createReq({
      headers: { authorization: 'Bearer secret' },
      body: { confirm: true }
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ deleted: 3 });
  });
});
