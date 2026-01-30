import { describe, expect, it } from 'vitest';
import { getDispatchTimeoutMs } from '../../api/_lib/dispatchConfig';

describe('dispatch config', () => {
  it('uses env override when valid', () => {
    process.env.WORKER_DISPATCH_TIMEOUT_MS = '20000';
    expect(getDispatchTimeoutMs()).toBe(20000);
    delete process.env.WORKER_DISPATCH_TIMEOUT_MS;
  });

  it('falls back to default for invalid values', () => {
    process.env.WORKER_DISPATCH_TIMEOUT_MS = 'not-a-number';
    expect(getDispatchTimeoutMs()).toBe(15000);
    process.env.WORKER_DISPATCH_TIMEOUT_MS = '-1';
    expect(getDispatchTimeoutMs()).toBe(15000);
    delete process.env.WORKER_DISPATCH_TIMEOUT_MS;
  });
});
