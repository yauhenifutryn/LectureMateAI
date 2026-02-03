import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, listDemoCodes, requireAdmin } from '../_lib/access.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    await enforceRateLimit(req, 'admin-list', getRateLimit('RATE_LIMIT_ADMIN', 60));
    requireAdmin(req);
    const codes = await listDemoCodes();
    return res.status(200).json({ codes });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to load codes.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
