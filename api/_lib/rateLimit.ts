import type { VercelRequest } from '@vercel/node';
import { kv } from '@vercel/kv';
import { ensureKvConfigured } from './access.js';

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
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) {
    return forwarded[0]?.split(',')[0]?.trim() || 'unknown';
  }
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0) {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || 'unknown';
};

export async function enforceRateLimit(
  req: VercelRequest,
  key: string,
  limit: number,
  windowSeconds = getRateLimitWindowSeconds()
): Promise<void> {
  ensureKvConfigured();
  const clientIp = getClientIp(req);
  const bucketKey = `ratelimit:${key}:${clientIp}`;
  const count = await kv.incr(bucketKey);
  if (count === 1) {
    await kv.expire(bucketKey, windowSeconds);
  }
  if (count > limit) {
    throw new RateLimitError();
  }
}
