import type http from 'http';
import { getJobRecord, updateJobRecord, acquireJobLease, releaseJobLease } from '../api/_lib/jobStore.js';
import { toPublicError } from '../api/_lib/errors.js';
import { runJob } from './handler.js';

export type WorkerAuthMode = 'cloud_tasks' | 'shared_secret';

export type WorkerTaskContext = {
  authMode: WorkerAuthMode;
  taskName: string;
  queueName?: string;
  retryCount: number;
};

export type WorkerTaskResponse = {
  statusCode: number;
  payload: Record<string, unknown>;
};

const RETRYABLE_ERROR_CODES = new Set([
  'overloaded_retry',
  'generation_retry',
  'dispatch_failed',
  'upstream_retry'
]);

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

export function authorizeWorkerRequest(
  headers: http.IncomingHttpHeaders | Record<string, string | string[] | undefined>
):
  | { ok: true; mode: WorkerAuthMode; taskName?: string; queueName?: string; retryCount: number }
  | { ok: false } {
  const authHeader = normalizeHeader(headers.authorization);
  const sharedSecret = process.env.WORKER_SHARED_SECRET?.trim();
  if (sharedSecret && authHeader === `Bearer ${sharedSecret}`) {
    return { ok: true, mode: 'shared_secret', retryCount: 0 };
  }

  const taskName = normalizeHeader(headers['x-cloudtasks-taskname']);
  const queueName = normalizeHeader(headers['x-cloudtasks-queuename']);
  if (taskName) {
    const retryCount = Number(normalizeHeader(headers['x-cloudtasks-taskretrycount']) ?? '0');
    return {
      ok: true,
      mode: 'cloud_tasks',
      taskName,
      queueName,
      retryCount: Number.isFinite(retryCount) && retryCount >= 0 ? retryCount : 0
    };
  }

  return { ok: false };
}

function isRetryableResult(result: { status: string; error?: { code?: string } }): boolean {
  return result.status === 'queued' && RETRYABLE_ERROR_CODES.has(result.error?.code ?? '');
}

export async function handleWorkerTask(
  jobId: string,
  context: WorkerTaskContext
): Promise<WorkerTaskResponse> {
  const job = await getJobRecord(jobId);
  if (!job) {
    return {
      statusCode: 404,
      payload: { error: { code: 'job_not_found', message: 'Job not found.' } }
    };
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return {
      statusCode: 200,
      payload: {
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        resultUrl: job.resultUrl,
        preview: job.preview,
        error: job.error
      }
    };
  }

  const taskName = context.taskName || `job-${jobId}`;
  const lease = await acquireJobLease(jobId, taskName);
  if (!lease) {
    const current = await getJobRecord(jobId);
    if (!current || current.status === 'completed' || current.status === 'failed') {
      return {
        statusCode: 200,
        payload: {
          jobId,
          status: current?.status ?? 'completed',
          duplicate: true
        }
      };
    }

    return {
      statusCode: 200,
      payload: {
        jobId,
        status: current.status,
        stage: current.stage,
        progress: current.progress,
        duplicate: true
      }
    };
  }

  const attemptCount = Math.max(job.attemptCount ?? 0, context.retryCount + 1);

  try {
    await updateJobRecord(jobId, {
      status: 'processing',
      stage: job.stage === 'queued' ? 'dispatching' : job.stage,
      progress: Math.max(job.progress ?? 0, 1),
      lastTaskName: taskName,
      attemptCount,
      leaseExpiresAt: lease.expiresAt
    });

    console.info('Worker task start:', {
      jobId,
      taskName,
      queueName: context.queueName,
      retryCount: context.retryCount,
      attemptCount
    });

    const result = await runJob(jobId, {
      taskName,
      queueName: context.queueName,
      retryCount: context.retryCount,
      attemptCount
    });

    console.info('Worker task result:', {
      jobId,
      taskName,
      status: result.status,
      stage: result.stage,
      errorCode: result.error?.code
    });

    if (isRetryableResult(result)) {
      return {
        statusCode: 503,
        payload: result
      };
    }

    return {
      statusCode: 200,
      payload: result
    };
  } catch (error) {
    console.error('Worker task failed:', { jobId, taskName, error });
    return {
      statusCode: 500,
      payload: { error: toPublicError(error) }
    };
  } finally {
    await releaseJobLease(jobId, taskName).catch((error) => {
      console.error('Failed to release job lease:', { jobId, taskName, error });
    });
  }
}
