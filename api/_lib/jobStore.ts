import { kv } from '@vercel/kv';
import crypto from 'crypto';
import { ensureKvConfigured, normalizeDemoCode } from './access.js';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type JobStage = 'queued' | 'dispatching' | 'uploading' | 'polling' | 'generating';

export type FilePayload = {
  objectName: string;
  mimeType: string;
};

export type JobAccess = {
  mode: 'admin' | 'demo';
  code?: string;
};

export type UploadedFileRef = {
  fileName: string;
  fileUri: string;
  mimeType: string;
  displayName: string;
};

export type TranscriptionMode = 'gemini' | 'enterprise_stt';

export type JobRecord = {
  id: string;
  status: JobStatus;
  stage: JobStage;
  request: {
    audio?: FilePayload;
    slides: FilePayload[];
    userContext?: string;
    modelId?: string;
    transcriptionMode?: TranscriptionMode;
  };
  access: JobAccess;
  createdAt: string;
  updatedAt: string;
  progress?: number;
  uploaded?: UploadedFileRef[];
  resultUrl?: string;
  transcriptUrl?: string;
  preview?: string;
  error?: { code?: string; message: string };
  attemptCount?: number;
  lastTaskName?: string;
  leaseExpiresAt?: string;
  lastErrorAt?: string;
};

const JOB_PREFIX = 'job:';
const ACTIVE_JOB_PREFIX = 'active-job:';
const JOB_LEASE_PREFIX = 'job-lease:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;
const DEFAULT_LEASE_TTL_SECONDS = 31 * 60;
const KV_RETRY_ATTEMPTS = 2;

async function withKvRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < KV_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function getJobKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}`;
}

function getActiveJobKey(access: JobAccess): string | null {
  if (access.mode === 'admin') return `${ACTIVE_JOB_PREFIX}admin`;
  if (access.mode === 'demo' && access.code) {
    return `${ACTIVE_JOB_PREFIX}demo:${normalizeDemoCode(access.code)}`;
  }
  return null;
}

export function buildJobId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

export function getJobTtlSeconds(): number {
  const raw = Number(process.env.JOB_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_SECONDS;
  return raw;
}

function getJobLeaseKey(jobId: string): string {
  return `${JOB_LEASE_PREFIX}${jobId}`;
}

function getJobLeaseTtlSeconds(): number {
  const raw = Number(process.env.JOB_LEASE_TTL_SECONDS ?? DEFAULT_LEASE_TTL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LEASE_TTL_SECONDS;
  return raw;
}

export async function setJobRecord(job: JobRecord): Promise<void> {
  ensureKvConfigured();
  await withKvRetry(() => kv.set(getJobKey(job.id), job, { ex: getJobTtlSeconds() }));
}

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  ensureKvConfigured();
  return (await withKvRetry(() => kv.get<JobRecord>(getJobKey(jobId)))) ?? null;
}

export async function updateJobRecord(
  jobId: string,
  patch: Partial<JobRecord>
): Promise<JobRecord> {
  const existing = await getJobRecord(jobId);
  if (!existing) {
    throw new Error('Job not found.');
  }

  const updated: JobRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  };

  if (patch.error !== undefined) {
    updated.lastErrorAt = patch.error ? updated.updatedAt : existing.lastErrorAt;
  }

  await setJobRecord(updated);
  return updated;
}

export async function setActiveJobId(access: JobAccess, jobId: string): Promise<void> {
  ensureKvConfigured();
  const key = getActiveJobKey(access);
  if (!key) return;
  await withKvRetry(() => kv.set(key, jobId, { ex: getJobTtlSeconds() }));
}

export async function getActiveJobId(access: JobAccess): Promise<string | null> {
  ensureKvConfigured();
  const key = getActiveJobKey(access);
  if (!key) return null;
  const value = await withKvRetry(() => kv.get<string>(key));
  return typeof value === 'string' && value ? value : null;
}

export async function clearActiveJobId(access: JobAccess, expectedJobId?: string): Promise<void> {
  ensureKvConfigured();
  const key = getActiveJobKey(access);
  if (!key) return;
  if (expectedJobId) {
    const current = await withKvRetry(() => kv.get<string>(key));
    if (current !== expectedJobId) return;
  }
  await withKvRetry(() => kv.del(key));
}

export async function acquireJobLease(
  jobId: string,
  owner: string
): Promise<{ owner: string; expiresAt: string } | null> {
  ensureKvConfigured();
  const ttlSeconds = getJobLeaseTtlSeconds();
  const lease = {
    owner,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
  };
  const result = await withKvRetry(() =>
    kv.set(getJobLeaseKey(jobId), lease, { nx: true, ex: ttlSeconds })
  );
  return result === 'OK' ? lease : null;
}

export async function getJobLease(
  jobId: string
): Promise<{ owner: string; expiresAt: string } | null> {
  ensureKvConfigured();
  return (
    (await withKvRetry(() =>
      kv.get<{ owner: string; expiresAt: string }>(getJobLeaseKey(jobId))
    )) ?? null
  );
}

export async function releaseJobLease(jobId: string, expectedOwner?: string): Promise<void> {
  ensureKvConfigured();
  const key = getJobLeaseKey(jobId);
  if (expectedOwner) {
    const current = await withKvRetry(() =>
      kv.get<{ owner: string; expiresAt: string }>(key)
    );
    if (!current || current.owner !== expectedOwner) return;
  }
  await withKvRetry(() => kv.del(key));
}
