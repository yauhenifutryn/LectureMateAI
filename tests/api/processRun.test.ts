import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/process';
import { buildJobId, getJobRecord, setJobRecord } from '../../api/_lib/jobStore';
import { generateStudyGuide } from '../../api/_lib/gemini';
import { storeResultMarkdown } from '../../api/_lib/resultStorage';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';

const kvStore = new Map<string, any>();

const kvMock = vi.hoisted(() => ({
  set: vi.fn(async (key: string, value: any) => {
    kvStore.set(key, value);
    return 'OK';
  }),
  get: vi.fn(async (key: string) => kvStore.get(key) ?? null)
}));

vi.mock('@vercel/kv', () => ({
  kv: kvMock
}));

vi.mock('../../api/_lib/gemini', () => ({
  generateStudyGuide: vi.fn(async () => '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript')
}));

vi.mock('../../api/_lib/resultStorage', () => ({
  storeResultMarkdown: vi.fn(async () => 'https://blob/results.md')
}));

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn(async () => {})
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

const createReq = (overrides: Partial<VercelRequest> = {}) =>
  ({
    method: 'POST',
    headers: {},
    body: {},
    ...overrides
  }) as VercelRequest;

const buildJob = (jobId: string) => ({
  id: jobId,
  status: 'queued' as const,
  stage: 'queued' as const,
  request: {
    audio: { fileUrl: 'https://blob/audio.mp3', mimeType: 'audio/mpeg' },
    slides: [{ fileUrl: 'https://blob/slide.pdf', mimeType: 'application/pdf' }],
    userContext: 'ctx'
  },
  access: {
    mode: 'demo' as const,
    code: 'DEMO123'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: 0
});

describe('process run endpoint', () => {
  beforeEach(() => {
    kvStore.clear();
    kvMock.set.mockClear();
    kvMock.get.mockClear();
    vi.mocked(generateStudyGuide).mockClear();
    vi.mocked(storeResultMarkdown).mockClear();
    vi.mocked(cleanupBlobUrls).mockClear();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns 404 when job missing', async () => {
    const req = createReq({ body: { action: 'run', jobId: 'missing', demoCode: 'DEMO123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('rejects mismatched demo code', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'WRONG' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it('runs job and stores result', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const payload = res.body as { status?: string; resultUrl?: string };
    expect(payload.status).toBe('completed');
    expect(payload.resultUrl).toBe('https://blob/results.md');

    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('completed');
    expect(updated?.resultUrl).toBe('https://blob/results.md');
    expect(vi.mocked(cleanupBlobUrls)).toHaveBeenCalledWith(
      ['https://blob/audio.mp3', 'https://blob/slide.pdf'],
      expect.any(Object)
    );
  });

  it('logs errors when processing fails', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuide).mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
