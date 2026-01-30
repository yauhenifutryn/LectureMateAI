import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, authorizeProcess } from '../_lib/access.js';
import { authorizeJobAccess } from '../_lib/jobAccess.js';
import { cleanupBlobUrls } from '../_lib/blobCleanup.js';
import { toPublicError } from '../_lib/errors.js';
import { generateStudyGuide } from '../_lib/gemini.js';
import { storeResultMarkdown } from '../_lib/resultStorage.js';
import {
  buildJobId,
  getJobRecord,
  setJobRecord,
  updateJobRecord
} from '../_lib/jobStore.js';
import { validateBlobUrl } from '../_lib/validateBlobUrl.js';

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

function buildPreview(text: string, maxChars = 2000): string {
  if (!text) return '';
  return text.slice(0, maxChars).trim();
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

  let authorized = false;

  try {
    authorizeJobAccess(req, job.access, demoCode);
    authorized = true;

    if (job.status !== 'queued') {
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Server Config Error: Missing API Key');
    }

    await updateJobRecord(jobId, {
      status: 'processing',
      stage: 'uploading',
      progress: 5
    });

    const resultText = await generateStudyGuide(apiKey, {
      audio: job.request.audio,
      slides: job.request.slides,
      userContext: job.request.userContext,
      modelId: job.request.modelId
    });

    await updateJobRecord(jobId, {
      stage: 'generating',
      progress: 80
    });

    const resultUrl = await storeResultMarkdown(
      resultText,
      job.request.audio?.fileUrl || job.request.slides[0]?.fileUrl
    );

    const completed = await updateJobRecord(jobId, {
      status: 'completed',
      stage: 'generating',
      progress: 100,
      resultUrl: resultUrl || undefined,
      preview: buildPreview(resultText),
      error: undefined
    });

    return res.status(200).json({
      jobId,
      status: completed.status,
      stage: completed.stage,
      progress: completed.progress,
      resultUrl: completed.resultUrl,
      preview: completed.preview
    });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    console.error('Process run failed:', error);
    const publicError = toPublicError(error);
    try {
      await updateJobRecord(jobId, {
        status: 'failed',
        stage: job.stage,
        error: publicError
      });
    } catch {
      // Best-effort update.
    }
    return res.status(500).json({ error: publicError, jobId, status: 'failed' });
  } finally {
    if (authorized && job.status === 'queued') {
      const cleanupUrls = [
        ...(job.request.audio?.fileUrl ? [job.request.audio.fileUrl] : []),
        ...job.request.slides.map((slide) => slide.fileUrl)
      ];
      if (cleanupUrls.length > 0) {
        await cleanupBlobUrls(cleanupUrls, console);
      }
    }
  }
}

async function handleStatus(req: VercelRequest, res: VercelResponse) {
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
