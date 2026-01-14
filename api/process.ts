import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del } from '@vercel/blob';
import { validateBlobUrl } from './_lib/validateBlobUrl';
import { toPublicError } from './_lib/errors';
import { generateStudyGuide } from './_lib/gemini';
import { SYSTEM_INSTRUCTION } from './_lib/prompts';

export const config = { maxDuration: 60 };

type FilePayload = {
  fileUrl: string;
  mimeType: string;
};

type ProcessBody = {
  audio?: FilePayload;
  slides?: FilePayload[];
  userContext?: string;
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

  const { audio, slides = [], userContext } = parseBody(req);
  const blobPrefix = process.env.BLOB_URL_PREFIX;
  const blobUrls: string[] = [];

  try {
    if (!audio?.fileUrl || !audio?.mimeType) {
      throw new Error('Missing audio payload.');
    }

    validateBlobUrl(audio.fileUrl, blobPrefix);
    blobUrls.push(audio.fileUrl);

    slides.forEach((slide) => {
      validateBlobUrl(slide.fileUrl, blobPrefix);
      blobUrls.push(slide.fileUrl);
    });

    const promptText = `${SYSTEM_INSTRUCTION}\n\nStudent's Additional Context:\n${
      userContext || 'None provided.'
    }\n\nGenerate the output using the strict separators defined in the System Instructions.`;

    const fullText = await generateStudyGuide(
      apiKey,
      audio.fileUrl,
      audio.mimeType,
      promptText
    );

    return res.status(200).json({ text: fullText });
  } catch (error) {
    const publicError = toPublicError(error);
    return res.status(500).json({ error: publicError });
  } finally {
    await Promise.all(blobUrls.map((url) => del(url).catch(() => null)));
  }
}
