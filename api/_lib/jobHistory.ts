import { kv } from '@vercel/kv';
import type { JobAccess, JobRecord } from './jobStore.js';
import { ensureKvConfigured, normalizeDemoCode } from './access.js';

export type HistoryItem = {
  jobId: string;
  createdAt: string;
  resultUrl?: string;
  transcriptUrl?: string;
  preview?: string;
  modelId?: string;
};

const HISTORY_PREFIX = 'history:';
const HISTORY_LIMIT = 50;

const buildHistoryKey = (access: JobAccess): string | null => {
  if (access.mode === 'admin') {
    return `${HISTORY_PREFIX}admin`;
  }
  if (access.mode === 'demo' && access.code) {
    return `${HISTORY_PREFIX}demo:${normalizeDemoCode(access.code)}`;
  }
  return null;
};

export async function recordJobHistory(job: JobRecord): Promise<void> {
  ensureKvConfigured();
  const key = buildHistoryKey(job.access);
  if (!key) return;
  const payload: HistoryItem = {
    jobId: job.id,
    createdAt: job.createdAt,
    resultUrl: job.resultUrl,
    transcriptUrl: job.transcriptUrl,
    preview: job.preview,
    modelId: job.request.modelId
  };
  await kv.lpush(key, JSON.stringify(payload));
  await kv.ltrim(key, 0, HISTORY_LIMIT - 1);
}

export async function listJobHistory(
  access: JobAccess,
  limit = 20
): Promise<HistoryItem[]> {
  ensureKvConfigured();
  const key = buildHistoryKey(access);
  if (!key) return [];
  const size = Math.max(1, Math.min(limit, HISTORY_LIMIT));
  const rows = (await kv.lrange(key, 0, size - 1)) as Array<string | HistoryItem>;
  return rows
    .map((row) => {
      if (!row) return null;
      if (typeof row === 'string') {
        try {
          return JSON.parse(row) as HistoryItem;
        } catch {
          return null;
        }
      }
      return row;
    })
    .filter((row): row is HistoryItem => row !== null);
}
