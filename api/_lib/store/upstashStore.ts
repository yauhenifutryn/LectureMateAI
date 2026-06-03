// api/_lib/store/upstashStore.ts
import { kv } from '@vercel/kv';
import type { AppStore, AccessEvent, HistoryItem, JobLease, RateLimitOutcome } from './types.js';
import type { JobRecord } from '../jobStore.js';

const DEMO_PREFIX = 'demo:code:';
const DEMO_SET_KEY = 'demo:codes';
const EVENT_LIST_KEY = 'audit:events';
const JOB_PREFIX = 'job:';
const JOB_LEASE_PREFIX = 'job-lease:';

function configureKvEnv(): void {
  if (!process.env.KV_REST_API_URL && process.env.UPSTASH_REDIS_REST_URL) {
    process.env.KV_REST_API_URL = process.env.UPSTASH_REDIS_REST_URL;
  }
  if (!process.env.KV_REST_API_TOKEN && process.env.UPSTASH_REDIS_REST_TOKEN) {
    process.env.KV_REST_API_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  }
  if (!process.env.KV_REST_API_READ_ONLY_TOKEN && process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN) {
    process.env.KV_REST_API_READ_ONLY_TOKEN = process.env.UPSTASH_REDIS_REST_READ_ONLY_TOKEN;
  }
  if (!process.env.KV_REST_API_READ_ONLY_TOKEN && process.env.KV_REST_API_TOKEN) {
    process.env.KV_REST_API_READ_ONLY_TOKEN = process.env.KV_REST_API_TOKEN;
  }
}

export class UpstashStore implements AppStore {
  isConfigured(): boolean {
    configureKvEnv();
    return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  }

  async hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    const bucketKey = `ratelimit:${key}`;
    const count = await kv.incr(bucketKey);
    if (count === 1) {
      await kv.expire(bucketKey, windowSeconds);
    }
    return { allowed: count <= limit, count };
  }

  async setDemoCode(normalizedCode: string, uses: number): Promise<void> {
    await kv.set(`${DEMO_PREFIX}${normalizedCode}`, uses);
    await kv.sadd(DEMO_SET_KEY, normalizedCode);
  }

  async getDemoRemaining(normalizedCode: string): Promise<number | null> {
    const remaining = await kv.get<number>(`${DEMO_PREFIX}${normalizedCode}`);
    return typeof remaining === 'number' ? remaining : null;
  }

  async consumeDemoCode(normalizedCode: string): Promise<number | null> {
    const remaining = await kv.decr(`${DEMO_PREFIX}${normalizedCode}`);
    if (typeof remaining !== 'number') return null;
    if (remaining < 0) {
      await kv.set(`${DEMO_PREFIX}${normalizedCode}`, 0);
      return null;
    }
    return remaining;
  }

  async revokeDemoCode(normalizedCode: string): Promise<void> {
    await kv.del(`${DEMO_PREFIX}${normalizedCode}`);
    await kv.srem(DEMO_SET_KEY, normalizedCode);
  }

  async listDemoCodes(): Promise<Array<{ code: string; remaining: number }>> {
    const codes = (await kv.smembers(DEMO_SET_KEY)) as string[];
    if (!codes || codes.length === 0) return [];
    const results: Array<{ code: string; remaining: number }> = [];
    await Promise.all(
      codes.map(async (code) => {
        const remaining = (await kv.get<number>(`${DEMO_PREFIX}${code}`)) ?? null;
        if (typeof remaining === 'number') results.push({ code, remaining });
      })
    );
    return results.sort((a, b) => a.code.localeCompare(b.code));
  }

  async appendEvent(event: AccessEvent, cap: number): Promise<void> {
    await kv.lpush(EVENT_LIST_KEY, JSON.stringify(event));
    await kv.ltrim(EVENT_LIST_KEY, 0, cap - 1);
  }

  async listEvents(limit: number): Promise<AccessEvent[]> {
    const rows = (await kv.lrange(EVENT_LIST_KEY, 0, limit - 1)) as Array<string | AccessEvent>;
    return rows
      .map((row) => {
        if (!row) return null;
        if (typeof row === 'string') {
          try {
            return JSON.parse(row) as AccessEvent;
          } catch {
            return null;
          }
        }
        return row;
      })
      .filter((row): row is AccessEvent => row !== null);
  }

  async setJob(job: JobRecord, ttlSeconds: number): Promise<void> {
    await kv.set(`${JOB_PREFIX}${job.id}`, job, { ex: ttlSeconds });
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    return (await kv.get<JobRecord>(`${JOB_PREFIX}${jobId}`)) ?? null;
  }

  async setActiveJob(scopeKey: string, jobId: string, ttlSeconds: number): Promise<void> {
    await kv.set(scopeKey, jobId, { ex: ttlSeconds });
  }

  async getActiveJob(scopeKey: string): Promise<string | null> {
    const value = await kv.get<string>(scopeKey);
    return typeof value === 'string' && value ? value : null;
  }

  async clearActiveJob(scopeKey: string, expectedJobId?: string): Promise<void> {
    if (expectedJobId) {
      const current = await kv.get<string>(scopeKey);
      if (current !== expectedJobId) return;
    }
    await kv.del(scopeKey);
  }

  async acquireLease(jobId: string, owner: string, ttlSeconds: number): Promise<JobLease | null> {
    const lease: JobLease = {
      owner,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
    };
    const result = await kv.set(`${JOB_LEASE_PREFIX}${jobId}`, lease, { nx: true, ex: ttlSeconds });
    return result === 'OK' ? lease : null;
  }

  async getLease(jobId: string): Promise<JobLease | null> {
    return (await kv.get<JobLease>(`${JOB_LEASE_PREFIX}${jobId}`)) ?? null;
  }

  async releaseLease(jobId: string, expectedOwner?: string): Promise<void> {
    const key = `${JOB_LEASE_PREFIX}${jobId}`;
    if (expectedOwner) {
      const current = await kv.get<JobLease>(key);
      if (!current || current.owner !== expectedOwner) return;
    }
    await kv.del(key);
  }

  async appendHistory(scopeKey: string, item: HistoryItem, cap: number): Promise<void> {
    await kv.lpush(scopeKey, JSON.stringify(item));
    await kv.ltrim(scopeKey, 0, cap - 1);
  }

  async listHistory(scopeKey: string, limit: number): Promise<HistoryItem[]> {
    const rows = (await kv.lrange(scopeKey, 0, limit - 1)) as Array<string | HistoryItem>;
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
}
