import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../api/process';
import { buildJobId, setJobRecord } from '../../api/_lib/jobStore';

const storeMock = vi.hoisted(() => {
  const jobs = new Map<string, any>();
  return {
    isConfigured: vi.fn(() => true),
    setJob: vi.fn(async (job: any) => {
      jobs.set(job.id, job);
    }),
    getJob: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    setActiveJob: vi.fn(async () => {}),
    getActiveJob: vi.fn(async () => null),
    clearActiveJob: vi.fn(async () => {}),
    acquireLease: vi.fn(async () => null),
    getLease: vi.fn(async () => null),
    releaseLease: vi.fn(async () => {}),
    appendHistory: vi.fn(async () => {}),
    listHistory: vi.fn(async () => []),
    _jobs: jobs
  };
});

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

const createRes = () => {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as VercelResponse & {
    statusCode: number;
    body: unknown;
    headers: Record<string, string>;
  };
};

const createReq = (overrides: Partial<VercelRequest> = {}) =>
  ({
    method: 'GET',
    headers: {},
    query: {},
    ...overrides
  }) as VercelRequest;

const buildJob = (jobId: string) => ({
  id: jobId,
  status: 'processing' as const,
  stage: 'uploading' as const,
  request: {
    audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
    slides: [],
    userContext: 'ctx'
  },
  access: {
    mode: 'demo' as const,
    code: 'DEMO123'
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  progress: 45,
  preview: 'preview text'
});

describe('process status endpoint', () => {
  beforeEach(() => {
    storeMock._jobs.clear();
    storeMock.setJob.mockClear();
    storeMock.getJob.mockClear();
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns 404 when job missing', async () => {
    const req = createReq({ query: { jobId: 'missing', demoCode: 'DEMO123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid demo code', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));

    const req = createReq({ query: { jobId, demoCode: 'WRONG' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it('returns job status for authorized caller', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));

    const req = createReq({ query: { jobId, demoCode: 'demo123' } });
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        jobId,
        status: 'processing',
        stage: 'uploading',
        progress: 45,
        preview: 'preview text',
        inputs: {
          audio: true,
          slidesCount: 0
        }
      })
    );
  });
});
