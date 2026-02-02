import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJobId, getJobRecord, setJobRecord } from '../../api/_lib/jobStore';
import {
  uploadGeminiFiles,
  checkGeminiFiles,
  generateStudyGuideFromUploaded,
  OverloadRetryError
} from '../../api/_lib/gemini';
import { storeResultMarkdown } from '../../api/_lib/resultStorage';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';
import { runJob } from '../../worker/handler';

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
  uploadGeminiFiles: vi.fn(async () => [
    {
      fileName: 'file-1',
      fileUri: 'gs://file-1',
      mimeType: 'audio/mpeg',
      displayName: 'Lecture Audio'
    }
  ]),
  checkGeminiFiles: vi.fn(async () => ({
    ready: true,
    failed: false,
    readyCount: 1,
    total: 1
  })),
  getModelId: vi.fn((modelId?: string) => modelId ?? 'gemini-3-flash-preview'),
  generateStudyGuideFromUploaded: vi.fn(
    async () => '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript'
  ),
  cleanupGeminiFiles: vi.fn(async () => {}),
  OverloadRetryError: class OverloadRetryError extends Error {
    code = 'overload_retry';
    constructor(message = 'Gemini overloaded. Retry later.') {
      super(message);
      this.name = 'OverloadRetryError';
    }
  },
  GenerationRetryError: class GenerationRetryError extends Error {
    code = 'generation_retry';
    constructor(message = 'Gemini generation retry.') {
      super(message);
      this.name = 'GenerationRetryError';
    }
  }
}));

vi.mock('../../api/_lib/resultStorage', () => ({
  storeResultMarkdown: vi.fn(async () => 'https://blob/results.md')
}));

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn(async () => {})
}));

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

describe('worker runJob', () => {
  beforeEach(() => {
    kvStore.clear();
    kvMock.set.mockClear();
    kvMock.get.mockClear();
    vi.mocked(uploadGeminiFiles).mockClear();
    vi.mocked(checkGeminiFiles).mockClear();
    vi.mocked(generateStudyGuideFromUploaded).mockClear();
    vi.mocked(storeResultMarkdown).mockClear();
    vi.mocked(cleanupBlobUrls).mockClear();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('returns existing completion without reprocessing', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      status: 'completed',
      stage: 'generating',
      resultUrl: 'https://blob/results.md'
    });

    const result = await runJob(jobId);

    expect(result.status).toBe('completed');
    expect(vi.mocked(generateStudyGuideFromUploaded)).not.toHaveBeenCalled();
  });

  it('processes a queued job and stores the result', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));

    const result = await runJob(jobId);

    expect(result.status).toBe('completed');
    expect(result.resultUrl).toBe('https://blob/results.md');
    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('completed');
  });

  it('fails when transcript is missing from output', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuideFromUploaded).mockResolvedValueOnce(
      '===STUDY_GUIDE===Guide===TRANSCRIPT==='
    );

    const result = await runJob(jobId);

    expect(result.status).toBe('failed');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('transcript_missing');
  });

  it('logs the model id used for generation', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      request: {
        ...buildJob(jobId).request,
        modelId: 'gemini-3-pro-preview'
      }
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await runJob(jobId);

    expect(infoSpy).toHaveBeenCalledWith('Worker model:', 'gemini-3-pro-preview');
    infoSpy.mockRestore();
  });

  it('requeues when Gemini is overloaded', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuideFromUploaded).mockRejectedValueOnce(
      new OverloadRetryError()
    );

    const result = await runJob(jobId);

    expect(result.status).toBe('queued');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('overloaded_retry');
  });
});
