import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJobId, getJobRecord, setJobRecord } from '../../api/_lib/jobStore';
import {
  uploadGeminiFiles,
  checkGeminiFiles,
  generateStudyGuideFromUploaded,
  OverloadRetryError
} from '../../api/_lib/gemini';
import { generateTranscriptFromSpeech } from '../../api/_lib/speechTranscript';
import { storeResultMarkdown, storeTranscriptText } from '../../api/_lib/resultStorage';
import { cleanupBlobUrls } from '../../api/_lib/blobCleanup';
import { runJob } from '../../worker/handler';

const kvStore = new Map<string, any>();

const kvMock = vi.hoisted(() => ({
  set: vi.fn(async (key: string, value: any) => {
    kvStore.set(key, value);
    return 'OK';
  }),
  get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
  lpush: vi.fn(async () => 1),
  ltrim: vi.fn(async () => 'OK')
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

vi.mock('../../api/_lib/speechTranscript', () => ({
  generateTranscriptFromSpeech: vi.fn(async () => 'Transcript')
}));

vi.mock('../../api/_lib/resultStorage', () => ({
  storeResultMarkdown: vi.fn(async () => 'https://gcs/results.md'),
  storeTranscriptText: vi.fn(async () => 'https://gcs/transcript.md')
}));

vi.mock('../../api/_lib/blobCleanup', () => ({
  cleanupBlobUrls: vi.fn(async () => {})
}));

vi.mock('../../api/_lib/gcs', () => ({
  getMaxUploadBytes: vi.fn(() => 512 * 1024 * 1024),
  getObjectSizeBytes: vi.fn(async () => 1024)
}));

const buildJob = (jobId: string) => ({
  id: jobId,
  status: 'queued' as const,
  stage: 'queued' as const,
  request: {
    audio: { objectName: 'uploads/job/audio.mp3', mimeType: 'audio/mpeg' },
    slides: [{ objectName: 'uploads/job/slide.pdf', mimeType: 'application/pdf' }],
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
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    kvStore.clear();
    kvMock.set.mockClear();
    kvMock.get.mockClear();
    kvMock.lpush.mockClear();
    kvMock.ltrim.mockClear();
    vi.mocked(uploadGeminiFiles).mockReset();
    vi.mocked(uploadGeminiFiles).mockResolvedValue([
      {
        fileName: 'file-1',
        fileUri: 'gs://file-1',
        mimeType: 'audio/mpeg',
        displayName: 'Lecture Audio'
      }
    ]);
    vi.mocked(checkGeminiFiles).mockReset();
    vi.mocked(checkGeminiFiles).mockResolvedValue({
      ready: true,
      failed: false,
      readyCount: 1,
      total: 1
    });
    vi.mocked(generateTranscriptFromSpeech).mockReset();
    vi.mocked(generateTranscriptFromSpeech).mockResolvedValue('Transcript');
    vi.mocked(generateStudyGuideFromUploaded).mockReset();
    vi.mocked(generateStudyGuideFromUploaded).mockResolvedValue(
      '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript'
    );
    vi.mocked(storeResultMarkdown).mockClear();
    vi.mocked(storeTranscriptText).mockClear();
    vi.mocked(cleanupBlobUrls).mockClear();
    process.env.GEMINI_API_KEY = 'test-key';
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('returns existing completion without reprocessing', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      status: 'completed',
      stage: 'generating',
      resultUrl: 'https://gcs/results.md'
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
    expect(result.resultUrl).toBe('https://gcs/results.md');
    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('completed');
  });

  it('requeues when transcript generation returns empty output', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateTranscriptFromSpeech).mockResolvedValue('');

    const result = await runJob(jobId);

    expect(result.status).toBe('queued');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('generation_retry');
    expect(vi.mocked(cleanupBlobUrls)).not.toHaveBeenCalled();
  });

  it('requeues when transcript generation rejects with an empty transcript response error', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateTranscriptFromSpeech).mockRejectedValue(
      new Error('Received empty transcript response.')
    );

    const result = await runJob(jobId);

    expect(result.status).toBe('queued');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('generation_retry');
  });

  it('retries transcript generation locally before failing the job', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateTranscriptFromSpeech)
      .mockRejectedValueOnce(new Error('Received empty transcript response.'))
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('Recovered transcript');

    const result = await runJob(jobId);

    expect(result.status).toBe('completed');
    expect(vi.mocked(generateTranscriptFromSpeech)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(storeTranscriptText)).toHaveBeenCalledWith('Recovered transcript', jobId);
  });

  it('logs the model id used for generation', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      request: {
        ...buildJob(jobId).request,
        modelId: 'gemini-3.1-pro-preview'
      }
    });

    await runJob(jobId);

    expect(infoSpy).toHaveBeenCalledWith('Worker model:', 'gemini-3.1-pro-preview');
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

  it('requeues on transient upstream failures', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuideFromUploaded).mockRejectedValueOnce(new Error('fetch failed'));

    const result = await runJob(jobId);

    expect(result.status).toBe('queued');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('upstream_retry');
  });

  it('requeues when Gemini returns an empty study guide response', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuideFromUploaded).mockRejectedValueOnce(
      new Error('Received empty response from Gemini.')
    );

    const result = await runJob(jobId);

    expect(result.status).toBe('queued');
    const updated = await getJobRecord(jobId);
    expect(updated?.error?.code).toBe('generation_retry');
  });

  it('reports the latest stage when an unexpected error occurs after generation starts', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateStudyGuideFromUploaded).mockRejectedValueOnce(new Error('boom'));

    const result = await runJob(jobId, {
      taskName: 'job-task-1',
      retryCount: 0,
      attemptCount: 1
    });

    expect(result.status).toBe('failed');
    expect(result.stage).toBe('generating');
    const updated = await getJobRecord(jobId);
    expect(updated?.stage).toBe('generating');
  });

  it('falls back to study-guide-only completion after repeated empty transcript attempts', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    vi.mocked(generateTranscriptFromSpeech).mockRejectedValue(
      new Error('Received empty transcript response.')
    );

    const result = await runJob(jobId, {
      taskName: 'job-task-1',
      retryCount: 2,
      attemptCount: 3
    });

    expect(result.status).toBe('completed');
    expect(result.resultUrl).toBe('https://gcs/results.md');
    expect(vi.mocked(generateStudyGuideFromUploaded)).toHaveBeenCalled();
    expect(vi.mocked(storeTranscriptText)).toHaveBeenCalledWith(
      expect.stringContaining('Transcript unavailable'),
      jobId
    );
    const updated = await getJobRecord(jobId);
    expect(updated?.status).toBe('completed');
    expect(updated?.transcriptUrl).toBe('https://gcs/transcript.md');
  });
});
