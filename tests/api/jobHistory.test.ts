import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({ appendHistory: vi.fn(), listHistory: vi.fn(), isConfigured: vi.fn(() => true) }));
vi.mock('../../api/_lib/store', () => ({ getStore: () => storeMock }));
vi.mock('../../api/_lib/access', () => ({
  ensureKvConfigured: vi.fn(),
  normalizeDemoCode: (c: string) => c.trim().toUpperCase()
}));

import { recordJobHistory, listJobHistory } from '../../api/_lib/jobHistory';

describe('jobHistory via store', () => {
  beforeEach(() => Object.values(storeMock).forEach((f: any) => f.mockReset && f.mockReset()));

  it('records under the demo scope key', async () => {
    await recordJobHistory({
      id: 'job1', access: { mode: 'demo', code: 'abc' }, createdAt: 't', request: {}
    } as any);
    expect(storeMock.appendHistory).toHaveBeenCalledWith('history:demo:ABC', expect.objectContaining({ jobId: 'job1' }), 50);
  });

  it('lists from the store with a clamped limit', async () => {
    storeMock.listHistory.mockResolvedValueOnce([{ jobId: 'job1', createdAt: 't' }]);
    const items = await listJobHistory({ mode: 'admin' }, 20);
    expect(storeMock.listHistory).toHaveBeenCalledWith('history:admin', 20);
    expect(items).toHaveLength(1);
  });
});
