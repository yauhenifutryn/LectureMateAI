import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { validateBlobUrl } from './_lib/validateBlobUrl.js';
import { toPublicError } from './_lib/errors.js';
import { generateStudyGuide } from './_lib/gemini.js';
import { getSystemInstruction } from './_lib/prompts.js';
import { AccessError, authorizeProcess } from './_lib/access.js';
import { cleanupBlobUrls } from './_lib/blobCleanup.js';
import { storeResultMarkdown } from './_lib/resultStorage.js';

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: { code: 'missing_api_key', message: 'Server misconfigured.' } });
  }

  const { audio, slides = [], userContext, demoCode } = parseBody(req);
  const blobPrefix = process.env.BLOB_URL_PREFIX;
  const blobUrls: string[] = [];

  try {
    await authorizeProcess(req, demoCode);

    if ((!audio || !audio.fileUrl || !audio.mimeType) && slides.length === 0) {
      throw new Error('Missing audio or slide payload.');
    }

    if (audio?.fileUrl) {
      validateBlobUrl(audio.fileUrl, blobPrefix);
      blobUrls.push(audio.fileUrl);
    }

    slides.forEach((slide) => {
      validateBlobUrl(slide.fileUrl, blobPrefix);
      blobUrls.push(slide.fileUrl);
    });

  const promptText = `${getSystemInstruction()}\n\nStudent's Additional Context:\n${
    userContext || 'None provided.'
  }\n\nUser request: include transcript, slides, and raw notes verbatim. Use SOURCE_APPENDIX_MODE.\n\nGenerate the output using the strict separators defined in the System Instructions.`;

    const fullText = await generateStudyGuide(apiKey, {
      audio: audio?.fileUrl && audio?.mimeType ? audio : undefined,
      slides,
      userContext: promptText
    });

    const resultSourceUrl = audio?.fileUrl ?? slides[0]?.fileUrl;
    try {
      await storeResultMarkdown(fullText, resultSourceUrl);
    } catch (error) {
      console.error('Result storage failed:', error);
    }

    return res.status(200).json({ text: fullText });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError });
  } finally {
    await cleanupBlobUrls(blobUrls);
  }
}
