import type { VercelRequest } from '@vercel/node';
import { getStore } from './store/index.js';

export class RateLimitError extends Error {
  code = 'rate_limited';
  status = 429;

  constructor(message = 'Too many requests. Please try again shortly.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

const DEFAULT_WINDOW_SECONDS = 60;

const getEnvNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

export const getRateLimitWindowSeconds = (): number =>
  getEnvNumber(process.env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS);

export const getRateLimit = (envKey: string, fallback: number): number =>
  getEnvNumber(process.env[envKey], fallback);

const getClientIp = (req: VercelRequest): string => {
  const headers = req.headers ?? {};
  const forwarded = headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return forwarded[0]?.split(',')[0]?.trim() || 'unknown';
  }
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  const realIp = headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
};

// Per-instance in-memory fixed-window limiter, used ONLY as a fallback when the shared
// store is unreachable. This keeps brute-force protection active during a storage outage
// (a finite, throttled number of attempts per instance) rather than failing fully open,
// while still never hard-blocking login the way a fail-closed gate would.
type MemoryBucket = { count: number; resetAtMs: number };
const memoryBuckets = new Map<string, MemoryBucket>();
const MEMORY_BUCKET_CAP = 5000;

function hitMemoryRateLimit(
  bucketKey: string,
  limit: number,
  windowSeconds: number,
  nowMs: number
): boolean {
  const existing = memoryBuckets.get(bucketKey);
  if (!existing || existing.resetAtMs <= nowMs) {
    if (memoryBuckets.size >= MEMORY_BUCKET_CAP) {
      for (const [k, v] of memoryBuckets) {
        if (v.resetAtMs <= nowMs) memoryBuckets.delete(k);
      }
      // Hard ceiling: if nothing had expired (sustained outage with many distinct IPs),
      // evict the oldest bucket by insertion order so memory cannot grow without bound.
      if (memoryBuckets.size >= MEMORY_BUCKET_CAP) {
        const oldest = memoryBuckets.keys().next().value;
        if (oldest !== undefined) memoryBuckets.delete(oldest);
      }
    }
    memoryBuckets.set(bucketKey, { count: 1, resetAtMs: nowMs + windowSeconds * 1000 });
    return 1 <= limit;
  }
  existing.count += 1;
  return existing.count <= limit;
}

export async function enforceRateLimit(
  req: VercelRequest,
  key: string,
  limit: number,
  windowSeconds = getRateLimitWindowSeconds()
): Promise<void> {
  const clientIp = getClientIp(req);
  try {
    const { allowed } = await getStore().hitRateLimit(`${key}:${clientIp}`, limit, windowSeconds);
    if (!allowed) throw new RateLimitError();
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    // Shared store unreachable: fall back to a per-instance in-memory limiter. A storage
    // outage must never hard-block login (that was the original "fetch failed" bug), but it
    // must also not strip brute-force protection from an auth endpoint by failing fully open.
    console.warn('Rate limit store error; using in-memory fallback.', {
      key,
      message: error instanceof Error ? error.message : String(error)
    });
    const allowed = hitMemoryRateLimit(`${key}:${clientIp}`, limit, windowSeconds, Date.now());
    if (!allowed) throw new RateLimitError();
  }
}
