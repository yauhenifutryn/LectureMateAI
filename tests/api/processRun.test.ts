import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/process';
import { buildJobId, getJobRecord, setJobRecord } from '../../api/_lib/jobStore';
import { updateJobRecord } from '../../api/_lib/jobStore';

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

const fetchMock = vi.fn();

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
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
    process.env.WORKER_URL = 'https://worker.example.com';
    process.env.WORKER_SHARED_SECRET = 'secret';
    fetchMock.mockReset();
    // @ts-expect-error - override global fetch for tests
    global.fetch = fetchMock;
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

  it('dispatches to the worker for queued jobs', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example.com/worker/run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        })
      })
    );
    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('processing');
    expect(updated?.stage).toBe('dispatching');
  });

  it('returns 202 without dispatching when already processing', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    await updateJobRecord(jobId, {
      status: 'processing',
      stage: 'dispatching',
      progress: 1
    });

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 200 when job already completed', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      status: 'completed',
      stage: 'generating',
      resultUrl: 'https://blob/results.md',
      preview: 'preview'
    });

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const payload = res.body as { status?: string; resultUrl?: string };
    expect(payload.status).toBe('completed');
    expect(payload.resultUrl).toBe('https://blob/results.md');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps job queued when dispatch fails', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'fail' });

    const req = createReq({ body: { action: 'run', jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(502);
    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('queued');
    expect(updated?.error?.code).toBe('dispatch_failed');
  });
});
