import {
  buildResultObjectName,
  buildTranscriptObjectName,
  createSignedReadUrl,
  uploadTextObject
} from './gcs.js';

export async function storeResultMarkdown(content: string, jobId: string): Promise<string | null> {
  if (!content) return null;

  const objectName = buildResultObjectName(jobId);
  await uploadTextObject(objectName, content, 'text/markdown');
  return createSignedReadUrl(objectName);
}

export async function storeTranscriptText(
  content: string,
  jobId: string
): Promise<string | null> {
  if (!content) return null;
  const objectName = buildTranscriptObjectName(jobId);
  await uploadTextObject(objectName, content, 'text/markdown');
  return createSignedReadUrl(objectName);
}

export async function createResultReadUrl(jobId: string): Promise<string> {
  return createSignedReadUrl(buildResultObjectName(jobId));
}

export async function createTranscriptReadUrl(jobId: string): Promise<string> {
  return createSignedReadUrl(buildTranscriptObjectName(jobId));
}
