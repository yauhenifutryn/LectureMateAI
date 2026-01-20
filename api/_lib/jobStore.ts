import { kv } from '@vercel/kv';
import crypto from 'crypto';
import { ensureKvConfigured } from './access.js';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type JobStage = 'queued' | 'uploading' | 'polling' | 'generating';

export type FilePayload = {
  fileUrl: string;
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

export type JobRecord = {
  id: string;
  status: JobStatus;
  stage: JobStage;
  request: {
    audio?: FilePayload;
    slides: FilePayload[];
    userContext?: string;
  };
  access: JobAccess;
  createdAt: string;
  updatedAt: string;
  progress?: number;
  uploaded?: UploadedFileRef[];
  resultUrl?: string;
  preview?: string;
  error?: { code?: string; message: string };
};

const JOB_PREFIX = 'job:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24;

export function getJobKey(jobId: string): string {
  return `${JOB_PREFIX}${jobId}`;
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

export async function setJobRecord(job: JobRecord): Promise<void> {
  ensureKvConfigured();
  await kv.set(getJobKey(job.id), job, { ex: getJobTtlSeconds() });
}

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  ensureKvConfigured();
  return (await kv.get<JobRecord>(getJobKey(jobId))) ?? null;
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

  await setJobRecord(updated);
  return updated;
}
