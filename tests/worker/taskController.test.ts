import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildJobId, getJobRecord, setJobRecord } from '../../api/_lib/jobStore';

const storeMock = vi.hoisted(() => {
  const jobs = new Map<string, any>();
  const activeJobs = new Map<string, string>();
  const leases = new Map<string, { owner: string; expiresAt: string }>();
  return {
    isConfigured: vi.fn(() => true),
    setJob: vi.fn(async (job: any) => {
      jobs.set(job.id, job);
    }),
    getJob: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    setActiveJob: vi.fn(async (scopeKey: string, jobId: string) => {
      activeJobs.set(scopeKey, jobId);
    }),
    getActiveJob: vi.fn(async (scopeKey: string) => activeJobs.get(scopeKey) ?? null),
    clearActiveJob: vi.fn(async (scopeKey: string, expectedJobId?: string) => {
      if (expectedJobId && activeJobs.get(scopeKey) !== expectedJobId) return;
      activeJobs.delete(scopeKey);
    }),
    acquireLease: vi.fn(async (jobId: string, owner: string, ttlSeconds: number) => {
      const existing = leases.get(jobId);
      if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
        return null;
      }
      const lease = { owner, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
      leases.set(jobId, lease);
      return lease;
    }),
    getLease: vi.fn(async (jobId: string) => leases.get(jobId) ?? null),
    releaseLease: vi.fn(async (jobId: string, expectedOwner?: string) => {
      if (expectedOwner) {
        const current = leases.get(jobId);
        if (!current || current.owner !== expectedOwner) return;
      }
      leases.delete(jobId);
    }),
    appendHistory: vi.fn(async () => {}),
    listHistory: vi.fn(async () => []),
    _jobs: jobs,
    _activeJobs: activeJobs,
    _leases: leases
  };
});

const runJobMock = vi.fn();

vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));

vi.mock('../../worker/handler', () => ({
  runJob: runJobMock
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

describe('handleWorkerTask', () => {
  beforeEach(() => {
    storeMock._jobs.clear();
    storeMock._activeJobs.clear();
    storeMock._leases.clear();
    storeMock.setJob.mockClear();
    storeMock.getJob.mockClear();
    storeMock.acquireLease.mockClear();
    storeMock.releaseLease.mockClear();
    runJobMock.mockReset();
    process.env.KV_REST_API_URL = 'https://example.com';
    process.env.KV_REST_API_TOKEN = 'token';
    process.env.WORKER_SHARED_SECRET = 'secret';
    vi.resetModules();
  });

  it('accepts Cloud Tasks requests without shared-secret auth', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    runJobMock.mockResolvedValueOnce({
      jobId,
      status: 'completed',
      stage: 'generating',
      progress: 100
    });
    const { authorizeWorkerRequest, handleWorkerTask } = await import('../../worker/taskController');

    expect(
      authorizeWorkerRequest({
        'x-cloudtasks-taskname': 'job-task',
        'x-cloudtasks-queuename': 'lecturemate-worker-queue'
      })
    ).toEqual(
      expect.objectContaining({
        ok: true,
        mode: 'cloud_tasks'
      })
    );

    const response = await handleWorkerTask(jobId, {
      authMode: 'cloud_tasks',
      taskName: 'job-task',
      queueName: 'lecturemate-worker-queue',
      retryCount: 0
    });

    expect(response.statusCode).toBe(200);
    expect(runJobMock).toHaveBeenCalledWith(
      jobId,
      expect.objectContaining({
        taskName: 'job-task',
        retryCount: 0
      })
    );
  });

  it('returns success without re-running when another task already holds the lease', async () => {
    const jobId = buildJobId();
    await setJobRecord({
      ...buildJob(jobId),
      status: 'processing',
      stage: 'uploading'
    });
    storeMock._leases.set(jobId, {
      owner: 'job-task-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const { handleWorkerTask } = await import('../../worker/taskController');

    const response = await handleWorkerTask(jobId, {
      authMode: 'cloud_tasks',
      taskName: 'job-task-2',
      queueName: 'lecturemate-worker-queue',
      retryCount: 1
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual(expect.objectContaining({ duplicate: true }));
    expect(runJobMock).not.toHaveBeenCalled();
  });

  it('returns retryable HTTP status when job is re-queued for overload', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    runJobMock.mockResolvedValueOnce({
      jobId,
      status: 'queued',
      stage: 'queued',
      error: {
        code: 'overloaded_retry',
        message: 'Gemini is overloaded. Retrying shortly.'
      }
    });
    const { handleWorkerTask } = await import('../../worker/taskController');

    const response = await handleWorkerTask(jobId, {
      authMode: 'cloud_tasks',
      taskName: 'job-task-1',
      queueName: 'lecturemate-worker-queue',
      retryCount: 2
    });

    expect(response.statusCode).toBe(503);
    expect(response.payload.error.code).toBe('overloaded_retry');
  });

  it('records task metadata on the job before execution', async () => {
    const jobId = buildJobId();
    await setJobRecord(buildJob(jobId));
    runJobMock.mockResolvedValueOnce({
      jobId,
      status: 'completed',
      stage: 'generating',
      progress: 100
    });
    const { handleWorkerTask } = await import('../../worker/taskController');

    await handleWorkerTask(jobId, {
      authMode: 'cloud_tasks',
      taskName: 'job-task-3',
      queueName: 'lecturemate-worker-queue',
      retryCount: 4
    });

    const updated = await getJobRecord(jobId);
    expect(updated?.lastTaskName).toBe('job-task-3');
    expect(updated?.attemptCount).toBe(5);
    expect(updated?.leaseExpiresAt).toBeTruthy();
  });
});
