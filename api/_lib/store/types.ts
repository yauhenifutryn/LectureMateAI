// api/_lib/store/types.ts
import type { JobRecord } from '../jobStore.js';

export type StoreAccessMode = 'admin' | 'demo';

export type AccessEvent = {
  at: string;
  mode: StoreAccessMode;
  action: 'process' | 'chat' | 'auth' | 'history';
  code?: string;
};

export type HistoryItem = {
  jobId: string;
  createdAt: string;
  resultUrl?: string;
  transcriptUrl?: string;
  preview?: string;
  modelId?: string;
};

export type JobLease = { owner: string; expiresAt: string };

export type RateLimitOutcome = { allowed: boolean; count: number };

export interface AppStore {
  isConfigured(): boolean;

  // Rate limiting (fixed window). Throwing here is treated as an infra error by callers.
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome>;

  // Demo codes
  setDemoCode(normalizedCode: string, uses: number): Promise<void>;
  getDemoRemaining(normalizedCode: string): Promise<number | null>;
  consumeDemoCode(normalizedCode: string): Promise<number | null>;
  revokeDemoCode(normalizedCode: string): Promise<void>;
  listDemoCodes(): Promise<Array<{ code: string; remaining: number }>>;

  // Audit log (capped)
  appendEvent(event: AccessEvent, cap: number): Promise<void>;
  listEvents(limit: number): Promise<AccessEvent[]>;

  // Jobs
  setJob(job: JobRecord, ttlSeconds: number): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  setActiveJob(scopeKey: string, jobId: string, ttlSeconds: number): Promise<void>;
  getActiveJob(scopeKey: string): Promise<string | null>;
  clearActiveJob(scopeKey: string, expectedJobId?: string): Promise<void>;
  acquireLease(jobId: string, owner: string, ttlSeconds: number): Promise<JobLease | null>;
  getLease(jobId: string): Promise<JobLease | null>;
  releaseLease(jobId: string, expectedOwner?: string): Promise<void>;

  // History (capped per scope)
  appendHistory(scopeKey: string, item: HistoryItem, cap: number): Promise<void>;
  listHistory(scopeKey: string, limit: number): Promise<HistoryItem[]>;
}
