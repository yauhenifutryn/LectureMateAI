import type { VercelRequest, VercelResponse } from '@vercel/node';
import { listDemoCodes, requireAdmin } from '../_lib/access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    requireAdmin(req);
    const codes = await listDemoCodes();
    return res.status(200).json({ codes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized.';
    return res.status(401).json({ error: { code: 'unauthorized', message } });
  }
}
