import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvMock = vi.hoisted(() => ({
  set: vi.fn()
}));

vi.mock('@vercel/kv', () => ({
  kv: kvMock
}));

import { setJobRecord } from '../../api/_lib/jobStore';

describe('jobStore retry', () => {
  beforeEach(() => {
    kvMock.set.mockReset();
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('retries kv.set on transient failures', async () => {
    kvMock.set
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    await setJobRecord({
      id: 'job-1',
      status: 'queued',
      stage: 'queued',
      request: { slides: [] },
      access: { mode: 'demo', code: 'DEMO' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    expect(kvMock.set).toHaveBeenCalledTimes(2);
  });
});
