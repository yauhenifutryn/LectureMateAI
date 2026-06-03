import { describe, it, expect, vi, beforeEach } from 'vitest';

// Demo-code consumption + audit + job records all route through the store.
const storeMock = vi.hoisted(() => ({
  consumeDemoCode: vi.fn(async () => 2),
  appendEvent: vi.fn(async () => {}),
  setJob: vi.fn(async () => {}),
  getJob: vi.fn(async () => null),
  setActiveJob: vi.fn(async () => {}),
  getActiveJob: vi.fn(async () => null),
  clearActiveJob: vi.fn(async () => {}),
  acquireLease: vi.fn(async () => null),
  getLease: vi.fn(async () => null),
  releaseLease: vi.fn(async () => {}),
  appendHistory: vi.fn(async () => {}),
  listHistory: vi.fn(async () => []),
  isConfigured: vi.fn(() => true)
}));

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

vi.mock('../../api/_lib/gcs', async () => {
  const actual = await vi.importActual('../../api/_lib/gcs');
  return {
    ...actual,
    validateObjectName: vi.fn()
  };
});

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn()
}));

vi.mock('../../api/_lib/rateLimit', () => ({
  RateLimitError: class RateLimitError extends Error {
    status = 429;
    code = 'rate_limited';
  },
  enforceRateLimit: vi.fn(async () => {}),
  getRateLimit: vi.fn(() => 10)
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
    storeMock.setJob.mockClear();
    storeMock.setActiveJob.mockClear();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns a jobId and stores a queued job', async () => {
    const req = {
      method: 'POST',
      headers: {},
      body: {
        audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [],
        userContext: 'ctx',
        demoCode: 'demo'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    const payload = res.json.mock.calls[0][0] as { jobId: string };
    expect(payload.jobId).toBeTruthy();
    expect(storeMock.setJob).toHaveBeenCalledTimes(1);
    expect(storeMock.setActiveJob).toHaveBeenCalledTimes(1);
    const [stored] = storeMock.setJob.mock.calls[0];
    expect(stored.status).toBe('queued');
    expect(stored.request.audio.objectName).toBe('uploads/job/audio.mp3');
    expect(stored.access.mode).toBe('demo');
  });
});
