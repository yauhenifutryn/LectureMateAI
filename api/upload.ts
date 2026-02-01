import './_lib/warnings.js';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

export function buildUploadConfig() {
  return {
    allowedContentTypes: [
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/webm',
      'audio/x-m4a',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/pdf'
    ],
    maxFileSize: 1024 * 1024 * 1024
  };
}

function parseBody(req: VercelRequest): HandleUploadBody {
  if (!req.body) {
    throw new Error('Missing upload payload.');
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as HandleUploadBody;
  }
  return req.body as HandleUploadBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const body = parseBody(req);
  const { allowedContentTypes, maxFileSize } = buildUploadConfig();

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('lectures/')) {
          throw new Error('Invalid upload path.');
        }
        return {
          allowedContentTypes,
          maximumSizeInBytes: maxFileSize,
          tokenPayload: JSON.stringify({ scope: 'lecture-upload' })
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url);
      }
    });

    return res.status(200).json(jsonResponse);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
}
