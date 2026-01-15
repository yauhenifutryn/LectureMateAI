import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/admin/stats';
import { fetchBlobStats } from '../../api/_lib/blobAdmin';

vi.mock('../../api/_lib/blobAdmin', () => ({
  fetchBlobStats: vi.fn()
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
  method: 'GET',
  headers: {},
  ...overrides
}) as VercelRequest;

describe('admin stats endpoint', () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = 'secret';
    vi.mocked(fetchBlobStats).mockReset();
  });

  it('rejects non-GET methods', async () => {
    const req = createReq({ method: 'POST' });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it('returns stats for admin', async () => {
    vi.mocked(fetchBlobStats).mockResolvedValue({ totalSize: 123, fileCount: 4 });
    const req = createReq({
      headers: { authorization: 'Bearer secret' }
    });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ totalSize: 123, fileCount: 4 });
  });
});
