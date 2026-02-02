import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authorizeUpload } from '../_lib/access.js';
import { buildUploadObjectName, createSignedUploadUrl } from '../_lib/gcs.js';

type UploadRequest = {
  filename?: string;
  mimeType?: string;
  jobId?: string;
  demoCode?: string;
};

function parseBody(req: VercelRequest): UploadRequest {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as UploadRequest;
  }
  return req.body as UploadRequest;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  const { filename, mimeType, jobId, demoCode } = parseBody(req);
  if (!filename || !mimeType || !jobId) {
    return res.status(400).json({
      error: { code: 'invalid_payload', message: 'filename, mimeType, and jobId are required.' }
    });
  }

  await authorizeUpload(req, demoCode);

  const objectName = buildUploadObjectName(jobId, filename);
  const uploadUrl = await createSignedUploadUrl(objectName, mimeType);

  return res.status(200).json({ uploadUrl, objectName });
}
