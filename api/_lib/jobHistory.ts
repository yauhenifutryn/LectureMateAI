import type { JobAccess, JobRecord } from './jobStore.js';
import { ensureKvConfigured, normalizeDemoCode } from './access.js';
import { getStore } from './store/index.js';
import type { HistoryItem } from './store/types.js';

const HISTORY_PREFIX = 'history:';
const HISTORY_LIMIT = 50;

const buildHistoryKey = (access: JobAccess): string | null => {
  if (access.mode === 'admin') return `${HISTORY_PREFIX}admin`;
  if (access.mode === 'demo' && access.code) return `${HISTORY_PREFIX}demo:${normalizeDemoCode(access.code)}`;
  return null;
};

export type { HistoryItem };

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
  await getStore().appendHistory(key, payload, HISTORY_LIMIT);
}

export async function listJobHistory(access: JobAccess, limit = 20): Promise<HistoryItem[]> {
  ensureKvConfigured();
  const key = buildHistoryKey(access);
  if (!key) return [];
  const size = Math.max(1, Math.min(limit, HISTORY_LIMIT));
  return getStore().listHistory(key, size);
}
