import { describe, it, expect, vi, beforeEach } from 'vitest';

const kvMock = vi.hoisted(() => ({
  set: vi.fn(),
  decr: vi.fn(async () => 2),
  lpush: vi.fn(async () => 1),
  ltrim: vi.fn(async () => 'OK')
}));

vi.mock('@vercel/kv', () => ({
  kv: kvMock
}));

vi.mock('../../api/_lib/validateBlobUrl', () => ({
  validateBlobUrl: vi.fn()
}));

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn()
}));


import handler from '../../api/process';

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('process job creation', () => {
  beforeEach(() => {
    kvMock.set.mockReset();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns a jobId and stores a queued job', async () => {
    const req = {
      method: 'POST',
      headers: {},
      body: {
        audio: { fileUrl: 'https://blob/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [],
        userContext: 'ctx',
        demoCode: 'demo'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    const payload = res.json.mock.calls[0][0] as { jobId: string };
    expect(payload.jobId).toBeTruthy();
    expect(kvMock.set).toHaveBeenCalledTimes(1);
    const [, stored] = kvMock.set.mock.calls[0];
    expect(stored.status).toBe('queued');
    expect(stored.request.audio.fileUrl).toBe('https://blob/audio.mp3');
    expect(stored.access.mode).toBe('demo');
  });
});
