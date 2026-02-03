import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, authorizeHistory } from '../_lib/access.js';
import { listJobHistory } from '../_lib/jobHistory.js';
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
    const items = await listJobHistory(access, limit);
    return res.status(200).json({ items });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to load history.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
