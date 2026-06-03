// tests/store/upstashStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kvMock = vi.hoisted(() => ({
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  sadd: vi.fn(),
  srem: vi.fn(),
  smembers: vi.fn(),
  decr: vi.fn(),
  lpush: vi.fn(),
  ltrim: vi.fn(),
  lrange: vi.fn()
}));

vi.mock('@vercel/kv', () => ({ kv: kvMock }));

import { UpstashStore } from '../../api/_lib/store/upstashStore';

describe('UpstashStore', () => {
  beforeEach(() => {
    Object.values(kvMock).forEach((fn) => fn.mockReset());
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'token';
  });

  it('hitRateLimit increments and sets expiry on first hit', async () => {
    kvMock.incr.mockResolvedValueOnce(1);
    const store = new UpstashStore();
    const outcome = await store.hitRateLimit('admin-verify:1.2.3.4', 5, 60);
    expect(outcome).toEqual({ allowed: true, count: 1 });
    expect(kvMock.expire).toHaveBeenCalledWith('ratelimit:admin-verify:1.2.3.4', 60);
  });

  it('hitRateLimit reports not allowed past the limit', async () => {
    kvMock.incr.mockResolvedValueOnce(6);
    const store = new UpstashStore();
    const outcome = await store.hitRateLimit('admin-verify:1.2.3.4', 5, 60);
    expect(outcome.allowed).toBe(false);
    expect(kvMock.expire).not.toHaveBeenCalled();
  });

  it('consumeDemoCode floors at zero', async () => {
    kvMock.decr.mockResolvedValueOnce(-1);
    const store = new UpstashStore();
    const remaining = await store.consumeDemoCode('ABC');
    expect(remaining).toBeNull();
    expect(kvMock.set).toHaveBeenCalledWith('demo:code:ABC', 0);
  });
});
