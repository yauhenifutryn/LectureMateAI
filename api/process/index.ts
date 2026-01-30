import '../_lib/warnings.js';
import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, authorizeProcess } from '../_lib/access.js';
import { authorizeJobAccess } from '../_lib/jobAccess.js';
import { toPublicError } from '../_lib/errors.js';
import {
  buildJobId,
  getJobRecord,
  setJobRecord,
  updateJobRecord
} from '../_lib/jobStore.js';
import { validateBlobUrl } from '../_lib/validateBlobUrl.js';
import { getDispatchTimeoutMs } from '../_lib/dispatchConfig.js';

export const config = { maxDuration: 60 };

type FilePayload = {
  fileUrl: string;
  mimeType: string;
};

type ProcessAction = 'run';

type ProcessBody = {
  action?: ProcessAction;
  jobId?: string;
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
  modelId?: string;
  demoCode?: string;
};

const PROCESSING_STALE_MS = 0;
const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro']);

function parseBody(req: VercelRequest): ProcessBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ProcessBody;
  }
  return req.body as ProcessBody;
}

function getQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getProcessingStaleMs(): number {
  const raw = Number(process.env.PROCESSING_STALE_MS ?? PROCESSING_STALE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw;
}

async function dispatchToWorker(jobId: string): Promise<{ ok: boolean; status: number }> {
  const workerUrl = process.env.WORKER_URL;
  const workerSecret = process.env.WORKER_SHARED_SECRET;
  if (!workerUrl || !workerSecret) {
    throw new Error('Worker is not configured.');
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
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleCreate(req: VercelRequest, res: VercelResponse, body: ProcessBody) {
  const { audio, slides = [], userContext, demoCode, modelId } = body;
  const blobPrefix = process.env.BLOB_URL_PREFIX;

  try {
    const access = await authorizeProcess(req, demoCode);

    if ((!audio || !audio.fileUrl || !audio.mimeType) && slides.length === 0) {
      throw new Error('Missing audio or slide payload.');
    }

    if (audio?.fileUrl) {
      validateBlobUrl(audio.fileUrl, blobPrefix);
    }

    slides.forEach((slide) => {
      validateBlobUrl(slide.fileUrl, blobPrefix);
    });

    const jobId = buildJobId();
    const now = new Date().toISOString();

    await setJobRecord({
      id: jobId,
      status: 'queued',
      stage: 'queued',
      request: {
        audio: audio?.fileUrl && audio?.mimeType ? audio : undefined,
        slides,
        userContext,
        modelId: modelId && ALLOWED_MODELS.has(modelId) ? modelId : undefined
      },
      access: {
        mode: access.mode,
        code: access.code
      },
      createdAt: now,
      updatedAt: now,
      progress: 0
    });

    return res.status(200).json({ jobId });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error('Process create failed:', error);
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError });
  }
}

async function handleRun(req: VercelRequest, res: VercelResponse, body: ProcessBody) {
  const { jobId, demoCode } = body;
  if (!jobId) {
    return res
      .status(400)
      .json({ error: { code: 'missing_job_id', message: 'jobId is required.' } });
  }

  const job = await getJobRecord(jobId);
  if (!job) {
    return res
      .status(404)
      .json({ error: { code: 'job_not_found', message: 'Job not found.' } });
  }

  try {
    authorizeJobAccess(req, job.access, demoCode);

    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(200).json({
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        resultUrl: job.resultUrl,
        preview: job.preview,
        error: job.error
      });
    }

    if (job.status === 'processing') {
      return res.status(202).json({
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        resultUrl: job.resultUrl,
        preview: job.preview,
        error: job.error
      });
    }

    const dispatch = await dispatchToWorker(jobId);
    if (!dispatch.ok) {
      const retryError = {
        code: 'dispatch_failed',
        message: 'Worker dispatch failed. Try again shortly.'
      };
      const queued = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error: retryError
      });
      return res.status(502).json({
        jobId,
        status: queued.status,
        stage: queued.stage,
        progress: queued.progress,
        error: queued.error
      });
    }

    const updated = await updateJobRecord(jobId, {
      status: 'processing',
      stage: 'dispatching',
      progress: 1,
      error: undefined
    });

    return res.status(202).json({
      jobId,
      status: updated.status,
      stage: updated.stage,
      progress: updated.progress
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error('Process run failed:', error);
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError, jobId, status: 'failed' });
  }
}

async function handleStatus(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  const jobId = getQueryValue(req.query.jobId as string | string[] | undefined);
  const demoCode = getQueryValue(req.query.demoCode as string | string[] | undefined);

  if (!jobId) {
    return res
      .status(400)
      .json({ error: { code: 'missing_job_id', message: 'jobId is required.' } });
  }

  const job = await getJobRecord(jobId);
  if (!job) {
    return res
      .status(404)
      .json({ error: { code: 'job_not_found', message: 'Job not found.' } });
  }

  try {
    authorizeJobAccess(req, job.access, demoCode);

    if (job.status === 'processing') {
      const updatedAt = Date.parse(job.updatedAt);
      if (Number.isFinite(updatedAt)) {
        const ageMs = Date.now() - updatedAt;
        const staleMs = getProcessingStaleMs();
        if (staleMs > 0 && ageMs > staleMs) {
          const timeoutError = {
            code: 'processing_timeout',
            message: 'Processing timed out. Please retry.'
          };
          const failed = await updateJobRecord(jobId, {
            status: 'failed',
            error: timeoutError
          });
          return res.status(200).json({
            jobId,
            status: failed.status,
            stage: failed.stage,
            progress: failed.progress,
            resultUrl: failed.resultUrl,
            preview: failed.preview,
            error: failed.error
          });
        }
      }
    }

    return res.status(200).json({
      jobId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      resultUrl: job.resultUrl,
      preview: job.preview,
      error: job.error
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Failed to fetch status.' } });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return handleStatus(req, res);
  }

  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  const body = parseBody(req);
  if (body.action === 'run') {
    return handleRun(req, res, body);
  }

  return handleCreate(req, res, body);
}
