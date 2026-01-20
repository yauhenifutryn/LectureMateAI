import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError } from '../_lib/access.js';
import { authorizeJobAccess } from '../_lib/jobAccess.js';
import { cleanupBlobUrls } from '../_lib/blobCleanup.js';
import { toPublicError } from '../_lib/errors.js';
import { generateStudyGuide } from '../_lib/gemini.js';
import { storeResultMarkdown } from '../_lib/resultStorage.js';
import { getJobRecord, updateJobRecord } from '../_lib/jobStore.js';

export const config = { maxDuration: 60 };

type RunBody = {
  jobId?: string;
  demoCode?: string;
};

function parseBody(req: VercelRequest): RunBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as RunBody;
  }
  return req.body as RunBody;
}

function buildPreview(text: string, maxChars = 2000): string {
  if (!text) return '';
  return text.slice(0, maxChars).trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  const { jobId, demoCode } = parseBody(req);
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
      userContext: job.request.userContext
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
    const publicError = toPublicError(error);
    await updateJobRecord(jobId, {
      status: 'failed',
      stage: job.stage,
      error: publicError
    });
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
