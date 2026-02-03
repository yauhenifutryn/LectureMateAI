import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authorizeUpload } from '../_lib/access.js';
import {
  buildUploadObjectName,
  createSignedUploadUrl,
  getMaxUploadBytes
} from '../_lib/gcs.js';
import { RateLimitError, enforceRateLimit, getRateLimit } from '../_lib/rateLimit.js';

type UploadRequest = {
  filename?: string;
  mimeType?: string;
  jobId?: string;
  sizeBytes?: number;
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

  const { filename, mimeType, jobId, demoCode, sizeBytes: rawSizeBytes } = parseBody(req);
  const sizeBytes = Number(rawSizeBytes ?? 0);
  if (!filename || !mimeType || !jobId) {
    return res.status(400).json({
      error: { code: 'invalid_payload', message: 'filename, mimeType, and jobId are required.' }
    });
  }

  try {
    await enforceRateLimit(req, 'upload', getRateLimit('RATE_LIMIT_UPLOAD', 20));
    await authorizeUpload(req, demoCode);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    throw error;
  }

  const maxBytes = getMaxUploadBytes();
  if (Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes > maxBytes) {
    return res.status(413).json({
      error: { code: 'file_too_large', message: 'File exceeds the allowed upload size.' },
      maxBytes
    });
  }

  const objectName = buildUploadObjectName(jobId, filename);
  const uploadUrl = await createSignedUploadUrl(objectName, mimeType);

  return res.status(200).json({ uploadUrl, objectName, maxBytes });
}
