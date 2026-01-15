import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, getAdminToken, validateDemoCode } from '../_lib/access.js';
import { cleanupBlobUrls } from '../_lib/blobCleanup.js';
import { validateBlobUrl } from '../_lib/validateBlobUrl.js';

type DeleteBody = {
  urls?: string[];
  demoCode?: string;
};

function parseBody(req: VercelRequest): DeleteBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as DeleteBody;
  }
  return req.body as DeleteBody;
}

async function authorizeCleanup(req: VercelRequest, demoCode?: string): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);

  if (adminPassword && token && token === adminPassword) {
    return;
  }

  if (!demoCode) {
    throw new AccessError('missing_access_code', 'Access code required.', 401);
  }

  const remaining = await validateDemoCode(demoCode);
  if (remaining === null) {
    throw new AccessError('invalid_access_code', 'Invalid or exhausted demo code.', 401);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    const { urls, demoCode } = parseBody(req);
    if (!urls || urls.length === 0) {
      return res.status(400).json({ error: { code: 'missing_urls', message: 'urls required.' } });
    }

    await authorizeCleanup(req, demoCode);

    const blobPrefix = process.env.BLOB_URL_PREFIX;
    urls.forEach((url) => validateBlobUrl(url, blobPrefix));

    await cleanupBlobUrls(urls);
    return res.status(200).json({ deleted: urls.length });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to delete uploads.';
    return res.status(500).json({ error: { code: 'cleanup_failed', message } });
  }
}
