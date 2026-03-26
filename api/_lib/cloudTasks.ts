import { CloudTasksClient } from '@google-cloud/tasks';
import { getDispatchTimeoutMs } from './dispatchConfig.js';

export type EnqueueWorkerTaskResult = {
  ok: boolean;
  duplicate: boolean;
  taskName: string;
  mode: 'cloud_tasks' | 'direct_http';
  status?: number;
  error?: { code?: string; message: string };
};

const DEFAULT_TASK_LOCATION = 'us-central1';
const DEFAULT_TASK_DEADLINE_SECONDS = 30 * 60;

function getRequiredEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getCloudTasksConfig() {
  const projectId = getRequiredEnv('CLOUD_TASKS_PROJECT_ID');
  const location = getRequiredEnv('CLOUD_TASKS_LOCATION') ?? DEFAULT_TASK_LOCATION;
  const queueId = getRequiredEnv('CLOUD_TASKS_QUEUE_ID');
  const workerTaskUrl = getRequiredEnv('WORKER_TASK_URL');
  const serviceAccountEmail = getRequiredEnv('WORKER_TASK_SERVICE_ACCOUNT_EMAIL');
  const audience = getRequiredEnv('WORKER_TASK_AUDIENCE') ?? undefined;

  if (!projectId || !queueId || !workerTaskUrl || !serviceAccountEmail) {
    return null;
  }

  return {
    projectId,
    location,
    queueId,
    workerTaskUrl,
    serviceAccountEmail,
    audience
  };
}

function buildTaskId(jobId: string): string {
  return `job-${jobId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 500);
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  const details = 'details' in error ? (error as { details?: unknown }).details : undefined;
  const message = error instanceof Error ? error.message : '';
  return (
    code === 6 ||
    (typeof details === 'string' && details.toUpperCase().includes('ALREADY_EXISTS')) ||
    message.toUpperCase().includes('ALREADY_EXISTS')
  );
}

async function enqueueCloudTask(jobId: string): Promise<EnqueueWorkerTaskResult> {
  const config = getCloudTasksConfig();
  if (!config) {
    throw new Error('Cloud Tasks is not configured.');
  }

  const client = new CloudTasksClient();
  const parent = client.queuePath(config.projectId, config.location, config.queueId);
  const taskName = `${parent}/tasks/${buildTaskId(jobId)}`;
  const body = Buffer.from(JSON.stringify({ jobId })).toString('base64');

  try {
    const [task] = await client.createTask({
      parent,
      task: {
        name: taskName,
        dispatchDeadline: { seconds: DEFAULT_TASK_DEADLINE_SECONDS },
        httpRequest: {
          httpMethod: 'POST',
          url: config.workerTaskUrl,
          headers: {
            'Content-Type': 'application/json'
          },
          oidcToken: {
            serviceAccountEmail: config.serviceAccountEmail,
            audience: config.audience
          },
          body
        }
      }
    });
    return {
      ok: true,
      duplicate: false,
      taskName: task.name ?? taskName,
      mode: 'cloud_tasks'
    };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return {
        ok: true,
        duplicate: true,
        taskName,
        mode: 'cloud_tasks'
      };
    }
    const message = error instanceof Error ? error.message : 'Task enqueue failed.';
    return {
      ok: false,
      duplicate: false,
      taskName,
      mode: 'cloud_tasks',
      error: {
        code: 'task_enqueue_failed',
        message
      }
    };
  }
}

async function dispatchToWorker(jobId: string): Promise<EnqueueWorkerTaskResult> {
  const workerUrl = getRequiredEnv('WORKER_URL');
  const workerSecret = getRequiredEnv('WORKER_SHARED_SECRET');
  if (!workerUrl || !workerSecret) {
    return {
      ok: false,
      duplicate: false,
      taskName: buildTaskId(jobId),
      mode: 'direct_http',
      error: {
        code: 'task_enqueue_failed',
        message: 'Worker is not configured.'
      }
    };
  }

  const endpoint = workerUrl.replace(/\/$/, '') + '/worker/run';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getDispatchTimeoutMs());

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${workerSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ jobId }),
      signal: controller.signal
    });
    let payload: { error?: { code?: string; message?: string } } | null = null;
    try {
      payload = (await response.json()) as { error?: { code?: string; message?: string } };
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        duplicate: false,
        taskName: buildTaskId(jobId),
        mode: 'direct_http',
        status: response.status,
        error:
          payload?.error?.message !== undefined
            ? { code: payload.error.code, message: payload.error.message }
            : {
                code: 'dispatch_failed',
                message: `Worker dispatch failed (${response.status}).`
              }
      };
    }
    return {
      ok: true,
      duplicate: false,
      taskName: buildTaskId(jobId),
      mode: 'direct_http',
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      duplicate: false,
      taskName: buildTaskId(jobId),
      mode: 'direct_http',
      error: {
        code: 'dispatch_failed',
        message: error instanceof Error ? error.message : 'Worker dispatch failed.'
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function enqueueWorkerTask(jobId: string): Promise<EnqueueWorkerTaskResult> {
  if (getCloudTasksConfig()) {
    return enqueueCloudTask(jobId);
  }
  return dispatchToWorker(jobId);
}
