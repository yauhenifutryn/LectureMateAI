import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

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

export default async function handler(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const { allowedContentTypes, maxFileSize } = buildUploadConfig();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('lectures/')) {
          throw new Error('Invalid upload path.');
        }
        return {
          allowedContentTypes,
          maximumSize: maxFileSize,
          tokenPayload: JSON.stringify({ scope: 'lecture-upload' })
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url);
      }
    });

    return new Response(JSON.stringify(jsonResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
