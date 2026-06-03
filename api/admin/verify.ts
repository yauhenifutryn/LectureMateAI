import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, requireAdmin } from '../_lib/access.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    await enforceRateLimit(req, 'admin-verify', getRateLimit('RATE_LIMIT_ADMIN_VERIFY', 5));
    requireAdmin(req);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const isInfra = error instanceof Error && !(error instanceof AccessError);
    if (isInfra) {
      console.error('admin/verify infra error', {
        message: error instanceof Error ? error.message : String(error)
      });
      return res.status(503).json({
        error: {
          code: 'storage_unavailable',
          message: 'Service storage is temporarily unavailable. Please try again shortly.'
        }
      });
    }
    return res.status(401).json({ error: { code: 'unauthorized', message: 'Unauthorized.' } });
  }
}
