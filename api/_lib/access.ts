import type { VercelRequest } from '@vercel/node';
import crypto from 'crypto';
import { getStore } from './store/index.js';
import type { AccessEvent } from './store/types.js';

const EVENT_LIMIT = 200;

export type AccessMode = 'admin' | 'demo';

export type AccessResult = {
  mode: AccessMode;
  code?: string;
  remaining?: number;
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

export function isKvConfigured(): boolean {
  return getStore().isConfigured();
}

export function ensureKvConfigured(): void {
  if (!getStore().isConfigured()) {
    throw new Error('Store not configured.');
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
    if (!getStore().isConfigured()) return;
    await getStore().appendEvent(event, EVENT_LIMIT);
  } catch {
    // Best-effort logging.
  }
}

export async function storeDemoCode(code: string, uses: number): Promise<void> {
  ensureKvConfigured();
  await getStore().setDemoCode(normalizeDemoCode(code), uses);
}

export async function listDemoCodes(): Promise<Array<{ code: string; remaining: number }>> {
  ensureKvConfigured();
  return getStore().listDemoCodes();
}

export async function revokeDemoCode(code: string): Promise<void> {
  ensureKvConfigured();
  await getStore().revokeDemoCode(normalizeDemoCode(code));
}

export async function validateDemoCode(code: string): Promise<number | null> {
  const remaining = await getDemoCodeRemaining(code);
  if (remaining === null || remaining <= 0) return null;
  return remaining;
}

export async function getDemoCodeRemaining(code: string): Promise<number | null> {
  ensureKvConfigured();
  return getStore().getDemoRemaining(normalizeDemoCode(code));
}

export async function consumeDemoCode(code: string): Promise<number | null> {
  ensureKvConfigured();
  return getStore().consumeDemoCode(normalizeDemoCode(code));
}

export async function listAccessEvents(limit = 50): Promise<AccessEvent[]> {
  ensureKvConfigured();
  const size = Math.max(1, Math.min(limit, EVENT_LIMIT));
  return getStore().listEvents(size);
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

export async function recordDemoValidation(code: string): Promise<void> {
  await logAccessEvent({
    at: new Date().toISOString(),
    mode: 'demo',
    action: 'auth',
    code: normalizeDemoCode(code)
  });
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

export async function authorizeHistory(
  req: VercelRequest,
  demoCode?: string
): Promise<AccessResult> {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);

  if (adminPassword && token && token === adminPassword) {
    await logAccessEvent({ at: new Date().toISOString(), mode: 'admin', action: 'history' });
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
    action: 'history',
    code: normalizeDemoCode(demoCode)
  });

  return { mode: 'demo', code: normalizeDemoCode(demoCode), remaining };
}

export async function authorizeUpload(
  req: VercelRequest,
  demoCode?: string
): Promise<AccessResult> {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const token = getAdminToken(req);

  if (adminPassword && token && token === adminPassword) {
    await logAccessEvent({ at: new Date().toISOString(), mode: 'admin', action: 'auth' });
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
    action: 'auth',
    code: normalizeDemoCode(demoCode)
  });

  return { mode: 'demo', code: normalizeDemoCode(demoCode), remaining };
}
