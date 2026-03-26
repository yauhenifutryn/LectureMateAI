import '../_lib/warnings.js';
import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, authorizeProcess } from '../_lib/access.js';
import { authorizeJobAccess } from '../_lib/jobAccess.js';
import { toPublicError } from '../_lib/errors.js';
import {
  buildJobId,
  type TranscriptionMode,
  setActiveJobId,
  getJobRecord,
  setJobRecord,
  updateJobRecord
} from '../_lib/jobStore.js';
import { validateObjectName } from '../_lib/gcs.js';
import { enqueueWorkerTask } from '../_lib/cloudTasks.js';
import { getModelId } from '../_lib/gemini.js';
import { createResultReadUrl, createTranscriptReadUrl } from '../_lib/resultStorage.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

export const config = { maxDuration: 60 };

type FilePayload = {
  objectName: string;
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
  transcriptionMode?: string;
  demoCode?: string;
};

const PROCESSING_STALE_MS = 0;

const buildInputSummary = (audio?: FilePayload, slides: FilePayload[] = []) => ({
  audio: Boolean(audio),
  slidesCount: slides.length
});

async function buildResponseUrls(job: {
  id: string;
  status: string;
  resultUrl?: string;
  transcriptUrl?: string;
  request: { audio?: FilePayload };
}) {
  let resultUrl = job.resultUrl;
  let transcriptUrl = job.transcriptUrl;

  if (job.status === 'completed') {
    try {
      resultUrl = await createResultReadUrl(job.id);
    } catch {
      // Keep persisted fallback.
    }
    if (job.request.audio) {
      try {
        transcriptUrl = await createTranscriptReadUrl(job.id);
      } catch {
        // Keep persisted fallback.
      }
    }
  }

  return { resultUrl, transcriptUrl };
}

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

function resolveTranscriptionMode(
  requestedMode: string | undefined,
  accessMode: 'admin' | 'demo'
): TranscriptionMode {
  if (accessMode === 'admin' && requestedMode === 'enterprise_stt') {
    return 'enterprise_stt';
  }
  return 'gemini';
}

async function handleCreate(req: VercelRequest, res: VercelResponse, body: ProcessBody) {
  const { audio, slides = [], userContext, demoCode, modelId, transcriptionMode } = body;

  try {
    const access = await authorizeProcess(req, demoCode);

    if ((!audio || !audio.objectName || !audio.mimeType) && slides.length === 0) {
      throw new Error('Missing audio or slide payload.');
    }

    if (audio?.objectName) {
      validateObjectName(audio.objectName);
    }

    slides.forEach((slide) => {
      validateObjectName(slide.objectName);
    });

    const jobId = buildJobId();
    const now = new Date().toISOString();

    let resolvedModelId = getModelId(modelId);
    if (access.mode === 'demo' && resolvedModelId === 'gemini-3.1-pro-preview') {
      resolvedModelId = 'gemini-3-flash-preview';
    }
    const resolvedTranscriptionMode = resolveTranscriptionMode(transcriptionMode, access.mode);

    await setJobRecord({
      id: jobId,
      status: 'queued',
      stage: 'queued',
      request: {
        audio: audio?.objectName && audio?.mimeType ? audio : undefined,
        slides,
        userContext,
        modelId: resolvedModelId,
        transcriptionMode: resolvedTranscriptionMode
      },
      access: {
        mode: access.mode,
        code: access.code
      },
      createdAt: now,
      updatedAt: now,
      progress: 0
    });
    await setActiveJobId(
      { mode: access.mode, code: access.code },
      jobId
    );

    return res.status(202).json({ jobId });
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
      const urls = await buildResponseUrls(job);
      return res.status(200).json({
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        resultUrl: urls.resultUrl,
        transcriptUrl: urls.transcriptUrl,
        preview: job.preview,
        error: job.error,
        modelId: job.request.modelId,
        inputs: buildInputSummary(job.request.audio, job.request.slides)
      });
    }

    if (job.status === 'processing') {
      const urls = await buildResponseUrls(job);
      return res.status(202).json({
        jobId,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        resultUrl: urls.resultUrl,
        transcriptUrl: urls.transcriptUrl,
        preview: job.preview,
        error: job.error,
        modelId: job.request.modelId,
        inputs: buildInputSummary(job.request.audio, job.request.slides)
      });
    }

    let updated = await updateJobRecord(jobId, {
      status: 'processing',
      stage: 'dispatching',
      progress: 1,
      error: undefined
    });

    const enqueue = await enqueueWorkerTask(jobId);
    if (!enqueue.ok) {
      console.warn('Worker enqueue failed:', {
        jobId,
        taskName: enqueue.taskName,
        mode: enqueue.mode,
        error: enqueue.error
      });
      updated = await updateJobRecord(jobId, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        error:
          enqueue.error ?? {
            code: 'task_enqueue_failed',
            message: 'Task enqueue failed. Try again shortly.'
          }
      });
    } else {
      console.info('Worker task enqueued:', {
        jobId,
        taskName: enqueue.taskName,
        duplicate: enqueue.duplicate,
        mode: enqueue.mode
      });
    }

    return res.status(202).json({
      jobId,
      status: updated.status,
      stage: updated.stage,
      progress: updated.progress,
      modelId: job.request.modelId,
      inputs: buildInputSummary(job.request.audio, job.request.slides)
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
          const urls = await buildResponseUrls(failed);
          return res.status(200).json({
            jobId,
            status: failed.status,
            stage: failed.stage,
            progress: failed.progress,
            resultUrl: urls.resultUrl,
            transcriptUrl: urls.transcriptUrl,
            preview: failed.preview,
            error: failed.error,
            modelId: job.request.modelId
          });
        }
      }
    }

    const urls = await buildResponseUrls(job);
    return res.status(200).json({
      jobId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      resultUrl: urls.resultUrl,
      transcriptUrl: urls.transcriptUrl,
      preview: job.preview,
      error: job.error,
      modelId: job.request.modelId,
      inputs: buildInputSummary(job.request.audio, job.request.slides)
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

  try {
    await enforceRateLimit(req, 'process', getRateLimit('RATE_LIMIT_PROCESS', 10));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Rate limit check failed.' } });
  }

  const body = parseBody(req);
  if (body.action === 'run') {
    return handleRun(req, res, body);
  }

  return handleCreate(req, res, body);
}
