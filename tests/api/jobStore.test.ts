import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({
  setJob: vi.fn(),
  getJob: vi.fn(),
  setActiveJob: vi.fn(),
  getActiveJob: vi.fn(),
  clearActiveJob: vi.fn(),
  acquireLease: vi.fn(),
  getLease: vi.fn(),
  releaseLease: vi.fn(),
  isConfigured: vi.fn(() => true)
}));
vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));
vi.mock('../../api/_lib/access', () => ({
  ensureKvConfigured: vi.fn(),
  normalizeDemoCode: (c: string) => c.trim().toUpperCase()
}));

import { setActiveJobId, acquireJobLease } from '../../api/_lib/jobStore';

describe('jobStore via store', () => {
  beforeEach(() => Object.values(storeMock).forEach((f: any) => f.mockReset && f.mockReset()));

  it('setActiveJobId uses an admin scope key', async () => {
    await setActiveJobId({ mode: 'admin' }, 'job1');
    expect(storeMock.setActiveJob).toHaveBeenCalledWith('active-job:admin', 'job1', expect.any(Number));
  });

  it('acquireJobLease returns the lease when the store grants it', async () => {
    storeMock.acquireLease.mockResolvedValueOnce({ owner: 'w1', expiresAt: 'x' });
    const lease = await acquireJobLease('job1', 'w1');
    expect(lease).toEqual({ owner: 'w1', expiresAt: 'x' });
  });
});
