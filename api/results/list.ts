import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, authorizeHistory } from '../_lib/access.js';
import { listJobHistory } from '../_lib/jobHistory.js';
import { clearActiveJobId, getActiveJobId, getJobRecord } from '../_lib/jobStore.js';
import { createResultReadUrl, createTranscriptReadUrl } from '../_lib/resultStorage.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    await enforceRateLimit(req, 'results-list', getRateLimit('RATE_LIMIT_ADMIN', 60));
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Rate limit check failed.' } });
  }

  const demoCode = typeof req.query.demoCode === 'string' ? req.query.demoCode : undefined;
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(rawLimit) ? rawLimit : 20;

  try {
    const access = await authorizeHistory(req, demoCode);
    const rawItems = await listJobHistory(access, limit);
    const items = await Promise.all(
      rawItems.map(async (item) => {
        let resultUrl = item.resultUrl;
        let transcriptUrl = item.transcriptUrl;

        try {
          resultUrl = await createResultReadUrl(item.jobId);
        } catch {
          // Keep stored URL fallback.
        }

        if (transcriptUrl !== undefined) {
          try {
            transcriptUrl = await createTranscriptReadUrl(item.jobId);
          } catch {
            // Keep stored URL fallback.
          }
        }

        return {
          ...item,
          resultUrl,
          transcriptUrl
        };
      })
    );
    const activeJobId = await getActiveJobId(access);
    let activeJob: {
      jobId: string;
      status: string;
      stage?: string;
      progress?: number;
      modelId?: string;
      error?: { code?: string; message: string };
    } | null = null;

    if (activeJobId) {
      const job = await getJobRecord(activeJobId);
      if (!job) {
        await clearActiveJobId(access, activeJobId);
      } else if (job.status === 'queued' || job.status === 'processing') {
        activeJob = {
          jobId: job.id,
          status: job.status,
          stage: job.stage,
          progress: job.progress,
          modelId: job.request.modelId,
          error: job.error
        };
      } else {
        await clearActiveJobId(access, activeJobId);
      }
    }

    return res.status(200).json({ items, activeJob });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to load history.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
