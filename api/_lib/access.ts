import type { VercelRequest } from '@vercel/node';
import { kv } from '@vercel/kv';
import crypto from 'crypto';

const DEMO_PREFIX = 'demo:code:';
const DEMO_SET_KEY = 'demo:codes';
const EVENT_LIST_KEY = 'audit:events';
const EVENT_LIMIT = 200;

export type AccessMode = 'admin' | 'demo';

export type AccessResult = {
  mode: AccessMode;
  code?: string;
  remaining?: number;
};

type AccessEvent = {
  at: string;
  mode: AccessMode;
  action: 'process' | 'chat';
  code?: string;
};

export class AccessError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 401) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getAdminToken(req: VercelRequest): string | null {
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice('bearer '.length).trim() || null;
}

export function requireAdmin(req: VercelRequest): void {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);
  if (!adminPassword || !token || token !== adminPassword) {
    throw new AccessError('unauthorized', 'Unauthorized admin access.', 401);
  }
}

export function normalizeDemoCode(code: string): string {
  return code.trim().toUpperCase();
}

export function generateDemoCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function logAccessEvent(event: AccessEvent): Promise<void> {
  try {
    await kv.lpush(EVENT_LIST_KEY, JSON.stringify(event));
    await kv.ltrim(EVENT_LIST_KEY, 0, EVENT_LIMIT - 1);
  } catch {
    // Best-effort logging.
  }
}

export async function storeDemoCode(code: string, uses: number): Promise<void> {
  const normalized = normalizeDemoCode(code);
  await kv.set(`${DEMO_PREFIX}${normalized}`, uses);
  await kv.sadd(DEMO_SET_KEY, normalized);
}

export async function listDemoCodes(): Promise<Array<{ code: string; remaining: number }>> {
  const codes = (await kv.smembers(DEMO_SET_KEY)) as string[];
  if (!codes || codes.length === 0) return [];

  const results: Array<{ code: string; remaining: number }> = [];
  await Promise.all(
    codes.map(async (code) => {
      const remaining = (await kv.get<number>(`${DEMO_PREFIX}${code}`)) ?? null;
      if (typeof remaining === 'number') {
        results.push({ code, remaining });
      }
    })
  );

  return results.sort((a, b) => a.code.localeCompare(b.code));
}

export async function revokeDemoCode(code: string): Promise<void> {
  const normalized = normalizeDemoCode(code);
  await kv.del(`${DEMO_PREFIX}${normalized}`);
  await kv.srem(DEMO_SET_KEY, normalized);
}

export async function validateDemoCode(code: string): Promise<number | null> {
  const normalized = normalizeDemoCode(code);
  const remaining = await kv.get<number>(`${DEMO_PREFIX}${normalized}`);
  if (typeof remaining !== 'number') return null;
  if (remaining < 0) return null;
  return remaining;
}

export async function consumeDemoCode(code: string): Promise<number | null> {
  const normalized = normalizeDemoCode(code);
  const remaining = await kv.decr(`${DEMO_PREFIX}${normalized}`);
  if (typeof remaining !== 'number') return null;
  if (remaining < 0) {
    await kv.del(`${DEMO_PREFIX}${normalized}`);
    await kv.srem(DEMO_SET_KEY, normalized);
    return null;
  }
  return remaining;
}

export async function listAccessEvents(limit = 50): Promise<AccessEvent[]> {
  const size = Math.max(1, Math.min(limit, EVENT_LIMIT));
  const rows = (await kv.lrange(EVENT_LIST_KEY, 0, size - 1)) as string[];
  return rows
    .map((row) => {
      try {
        return JSON.parse(row) as AccessEvent;
      } catch {
        return null;
      }
    })
    .filter((row): row is AccessEvent => row !== null);
}

export async function authorizeProcess(
  req: VercelRequest,
  demoCode?: string
): Promise<AccessResult> {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);

  if (adminPassword && token && token === adminPassword) {
    await logAccessEvent({ at: new Date().toISOString(), mode: 'admin', action: 'process' });
    return { mode: 'admin' };
  }

  if (!demoCode) {
    throw new AccessError('missing_access_code', 'Access code required.', 401);
  }

  const remaining = await consumeDemoCode(demoCode);
  if (remaining === null) {
    throw new AccessError('invalid_access_code', 'Invalid or exhausted demo code.', 401);
  }

  await logAccessEvent({
    at: new Date().toISOString(),
    mode: 'demo',
    action: 'process',
    code: normalizeDemoCode(demoCode)
  });

  return { mode: 'demo', code: normalizeDemoCode(demoCode), remaining };
}

export async function authorizeChat(
  req: VercelRequest,
  demoCode?: string
): Promise<AccessResult> {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);

  if (adminPassword && token && token === adminPassword) {
    await logAccessEvent({ at: new Date().toISOString(), mode: 'admin', action: 'chat' });
    return { mode: 'admin' };
  }

  if (!demoCode) {
    throw new AccessError('missing_access_code', 'Access code required.', 401);
  }

  const remaining = await validateDemoCode(demoCode);
  if (remaining === null) {
    throw new AccessError('invalid_access_code', 'Invalid or exhausted demo code.', 401);
  }

  await logAccessEvent({
    at: new Date().toISOString(),
    mode: 'demo',
    action: 'chat',
    code: normalizeDemoCode(demoCode)
  });

  return { mode: 'demo', code: normalizeDemoCode(demoCode), remaining };
}
