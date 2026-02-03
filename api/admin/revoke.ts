import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, requireAdmin, revokeDemoCode } from '../_lib/access.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

type RevokeBody = {
  code?: string;
};

function parseBody(req: VercelRequest): RevokeBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as RevokeBody;
  }
  return req.body as RevokeBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    await enforceRateLimit(req, 'admin-revoke', getRateLimit('RATE_LIMIT_ADMIN', 60));
    requireAdmin(req);
    const { code } = parseBody(req);
    if (!code) {
      return res.status(400).json({ error: { code: 'missing_code', message: 'Code required.' } });
    }

    await revokeDemoCode(code);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to revoke code.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
