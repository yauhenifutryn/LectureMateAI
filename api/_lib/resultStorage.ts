import { put } from '@vercel/blob';

function sanitizeFileName(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, '').replace(/[^\w.-]/g, '_');
}

export function buildResultFilename(sourceUrl?: string, nowMs = Date.now()): string {
  if (!sourceUrl) {
    return `results/${nowMs}-analysis.md`;
  }

  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.split('/').pop() || 'analysis';
    const base = path.replace(/\.[^/.]+$/, '');
    return `results/${nowMs}-${sanitizeFileName(base)}.md`;
  } catch {
    return `results/${nowMs}-analysis.md`;
  }
}

export async function storeResultMarkdown(
  content: string,
  sourceUrl?: string,
  nowMs = Date.now()
): Promise<string | null> {
  if (!content) return null;

  const pathname = buildResultFilename(sourceUrl, nowMs);
  const blob = await put(pathname, content, {
    access: 'private',
    contentType: 'text/markdown'
  });

  return blob.url;
}
