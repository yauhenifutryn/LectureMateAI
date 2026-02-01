import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, requireAdmin } from '../_lib/access.js';
import { fetchBlobStats } from '../_lib/blobAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    requireAdmin(req);
    const stats = await fetchBlobStats();
    return res.status(200).json(stats);
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to load storage stats.';
    return res.status(500).json({ error: { code: 'blob_error', message } });
  }
}
