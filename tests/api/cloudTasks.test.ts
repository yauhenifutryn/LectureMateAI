import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTaskMock, queuePathMock } = vi.hoisted(() => ({
  createTaskMock: vi.fn(),
  queuePathMock: vi.fn((project: string, location: string, queue: string) =>
    `projects/${project}/locations/${location}/queues/${queue}`
  )
}));

vi.mock('@google-cloud/tasks', () => ({
  CloudTasksClient: class {
    queuePath = queuePathMock;
    createTask = createTaskMock;
  }
}));

describe('enqueueWorkerTask', () => {
  beforeEach(() => {
    createTaskMock.mockReset();
    queuePathMock.mockClear();
    process.env.CLOUD_TASKS_PROJECT_ID = 'lecturemateai-485823';
    process.env.CLOUD_TASKS_LOCATION = 'us-central1';
    process.env.CLOUD_TASKS_QUEUE_ID = 'lecturemate-worker-queue';
    process.env.WORKER_TASK_URL = 'https://lecturemate-worker.run.app/worker/run';
    process.env.WORKER_TASK_SERVICE_ACCOUNT_EMAIL =
      'lecturemate-tasks-invoker@lecturemateai-485823.iam.gserviceaccount.com';
    process.env.WORKER_TASK_AUDIENCE = 'https://lecturemate-worker.run.app';
    delete process.env.WORKER_URL;
    delete process.env.WORKER_SHARED_SECRET;
    vi.resetModules();
  });

  it('creates a deterministic Cloud Task with OIDC auth', async () => {
    createTaskMock.mockResolvedValueOnce([{ name: 'task-name' }]);
    const { enqueueWorkerTask } = await import('../../api/_lib/cloudTasks');

    const result = await enqueueWorkerTask('job-123');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: false,
        taskName: 'task-name'
      })
    );
    expect(queuePathMock).toHaveBeenCalledWith(
      'lecturemateai-485823',
      'us-central1',
      'lecturemate-worker-queue'
    );
    expect(createTaskMock).toHaveBeenCalledWith({
      parent: 'projects/lecturemateai-485823/locations/us-central1/queues/lecturemate-worker-queue',
      task: expect.objectContaining({
        name:
          'projects/lecturemateai-485823/locations/us-central1/queues/lecturemate-worker-queue/tasks/job-job-123',
        httpRequest: expect.objectContaining({
          url: 'https://lecturemate-worker.run.app/worker/run',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          oidcToken: {
            serviceAccountEmail:
              'lecturemate-tasks-invoker@lecturemateai-485823.iam.gserviceaccount.com',
            audience: 'https://lecturemate-worker.run.app'
          }
        })
      })
    });

    const body = createTaskMock.mock.calls[0][0].task.httpRequest.body;
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('{"jobId":"job-123"}');
  });

  it('treats already existing task names as success', async () => {
    const err = Object.assign(new Error('task exists'), { code: 6, details: 'ALREADY_EXISTS' });
    createTaskMock.mockRejectedValueOnce(err);
    const { enqueueWorkerTask } = await import('../../api/_lib/cloudTasks');

    const result = await enqueueWorkerTask('job-123');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: true,
        taskName:
          'projects/lecturemateai-485823/locations/us-central1/queues/lecturemate-worker-queue/tasks/job-job-123'
      })
    );
  });

  it('falls back to direct worker HTTP only when Cloud Tasks env is absent', async () => {
    delete process.env.CLOUD_TASKS_PROJECT_ID;
    delete process.env.CLOUD_TASKS_LOCATION;
    delete process.env.CLOUD_TASKS_QUEUE_ID;
    delete process.env.WORKER_TASK_URL;
    delete process.env.WORKER_TASK_SERVICE_ACCOUNT_EMAIL;
    delete process.env.WORKER_TASK_AUDIENCE;
    process.env.WORKER_URL = 'https://worker.example.com';
    process.env.WORKER_SHARED_SECRET = 'secret';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    // @ts-expect-error test override
    global.fetch = fetchMock;
    const { enqueueWorkerTask } = await import('../../api/_lib/cloudTasks');

    const result = await enqueueWorkerTask('job-123');

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        duplicate: false,
        mode: 'direct_http'
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://worker.example.com/worker/run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret'
        })
      })
    );
  });
});
