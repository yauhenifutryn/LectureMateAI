import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, requireAdmin } from '../_lib/access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    requireAdmin(req);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unauthorized.';
    return res.status(401).json({ error: { code: 'unauthorized', message } });
  }
}
