import { buildResultObjectName, createSignedReadUrl, uploadTextObject } from './gcs.js';

export async function storeResultMarkdown(content: string, jobId: string): Promise<string | null> {
  if (!content) return null;

  const objectName = buildResultObjectName(jobId);
  await uploadTextObject(objectName, content, 'text/markdown');
  return createSignedReadUrl(objectName);
}
