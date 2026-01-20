import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError } from '../_lib/access.js';
import { authorizeJobAccess } from '../_lib/jobAccess.js';
import { getJobRecord } from '../_lib/jobStore.js';

export const config = { maxDuration: 60 };

function getQueryValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

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
