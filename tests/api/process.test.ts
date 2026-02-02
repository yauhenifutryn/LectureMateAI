import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../api/process';
import { validateObjectName } from '../../api/_lib/gcs';
import { setJobRecord, updateJobRecord } from '../../api/_lib/jobStore';

vi.mock('../../api/_lib/access', () => ({
  authorizeProcess: vi.fn(async () => ({ mode: 'demo', code: 'DEMO123' })),
  AccessError: class AccessError extends Error {
    status = 401;
    code = 'unauthorized';
  }
}));

vi.mock('../../api/_lib/gcs', async () => {
  const actual = await vi.importActual('../../api/_lib/gcs');
  return {
    ...actual,
    validateObjectName: vi.fn()
  };
});

vi.mock('../../api/_lib/jobStore', () => ({
  buildJobId: () => 'job-123',
  setJobRecord: vi.fn(async () => {}),
  updateJobRecord: vi.fn(async (jobId: string, patch: any) => ({
    id: jobId,
    status: patch.status ?? 'queued',
    stage: patch.stage ?? 'queued',
    progress: patch.progress ?? 0,
    error: patch.error,
    request: {},
    access: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }))
}));

vi.mock('../../api/_lib/errors', () => ({
  toPublicError: () => ({ code: 'internal_error', message: 'Processing failed.' })
}));

const buildRes = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('process handler', () => {
  beforeEach(() => {
    vi.mocked(validateObjectName).mockReset();
    vi.mocked(setJobRecord).mockReset();
    vi.mocked(updateJobRecord).mockReset();
    process.env.WORKER_URL = 'https://worker.example.com';
    process.env.WORKER_SHARED_SECRET = 'secret';
  });

  afterEach(() => {
    delete process.env.WORKER_URL;
    delete process.env.WORKER_SHARED_SECRET;
    vi.restoreAllMocks();
  });

  it('validates audio and slide blob urls', async () => {
    const req = {
      method: 'POST',
      body: {
        audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [{ objectName: 'uploads/job/slide.pdf', mimeType: 'application/pdf' }],
        userContext: 'ctx'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(vi.mocked(validateObjectName)).toHaveBeenCalledWith('uploads/job/audio.mp3');
    expect(vi.mocked(validateObjectName)).toHaveBeenCalledWith('uploads/job/slide.pdf');
    expect(vi.mocked(setJobRecord)).toHaveBeenCalledOnce();
  });

  it('allows slides-only requests', async () => {
    const req = {
      method: 'POST',
      body: {
        slides: [{ objectName: 'uploads/job/slide.pdf', mimeType: 'application/pdf' }],
        userContext: 'ctx'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(vi.mocked(validateObjectName)).toHaveBeenCalledWith('uploads/job/slide.pdf');
    expect(vi.mocked(setJobRecord)).toHaveBeenCalledOnce();
  });

  it('stores allowed modelId in the job request', async () => {
    const req = {
      method: 'POST',
      body: {
        audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [],
        userContext: 'ctx',
        modelId: 'gemini-3-pro-preview'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    const call = vi.mocked(setJobRecord).mock.calls[0]?.[0] as any;
    expect(call?.request?.modelId).toBe('gemini-3-pro-preview');
  });

  it('returns 202 even when worker dispatch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('dispatch failed'));
    (global as any).fetch = fetchMock;

    const req = {
      method: 'POST',
      body: {
        audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
        slides: [],
        userContext: 'ctx'
      }
    } as any;

    const res = buildRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
  });
});
