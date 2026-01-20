import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateBlobUrl } from '../_lib/validateBlobUrl.js';
import { toPublicError } from '../_lib/errors.js';
import { AccessError, authorizeProcess } from '../_lib/access.js';
import { buildJobId, setJobRecord } from '../_lib/jobStore.js';

export const config = { maxDuration: 60 };

type FilePayload = {
  fileUrl: string;
  mimeType: string;
};

type ProcessBody = {
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
  demoCode?: string;
};

function parseBody(req: VercelRequest): ProcessBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ProcessBody;
  }
  return req.body as ProcessBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  const { audio, slides = [], userContext, demoCode } = parseBody(req);
  const blobPrefix = process.env.BLOB_URL_PREFIX;

  try {
    const access = await authorizeProcess(req, demoCode);

    if ((!audio || !audio.fileUrl || !audio.mimeType) && slides.length === 0) {
      throw new Error('Missing audio or slide payload.');
    }

    if (audio?.fileUrl) {
      validateBlobUrl(audio.fileUrl, blobPrefix);
    }

    slides.forEach((slide) => {
      validateBlobUrl(slide.fileUrl, blobPrefix);
    });

    const jobId = buildJobId();
    const now = new Date().toISOString();

    await setJobRecord({
      id: jobId,
      status: 'queued',
      stage: 'queued',
      request: {
        audio: audio?.fileUrl && audio?.mimeType ? audio : undefined,
        slides,
        userContext
      },
      access: {
        mode: access.mode,
        code: access.code
      },
      createdAt: now,
      updatedAt: now,
      progress: 0
    });

    return res.status(200).json({ jobId });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError });
  }
}
