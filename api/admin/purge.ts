import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, requireAdmin } from '../_lib/access.js';
import { purgeAllBlobs } from '../_lib/blobAdmin.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    requireAdmin(req);
    const { confirm } = req.body ?? {};
    if (confirm !== true) {
      return res.status(400).json({
        error: { code: 'confirm_required', message: 'Confirmation required.' }
      });
    }
    const deleted = await purgeAllBlobs();
    return res.status(200).json({ deleted });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to purge storage.';
    return res.status(500).json({ error: { code: 'blob_error', message } });
  }
}
