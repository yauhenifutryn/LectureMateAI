// tests/store/index.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/_lib/store/firestoreStore', () => ({
  FirestoreStore: class { kind = 'firestore'; isConfigured() { return true; } }
}));
vi.mock('../../api/_lib/store/upstashStore', () => ({
  UpstashStore: class { kind = 'upstash'; isConfigured() { return true; } }
}));

import { getStore, resetStoreForTests } from '../../api/_lib/store/index';

describe('getStore', () => {
  afterEach(() => {
    resetStoreForTests();
    delete process.env.STORE_BACKEND;
  });

  it('defaults to firestore', () => {
    expect((getStore() as any).kind).toBe('firestore');
  });

  it('selects upstash when STORE_BACKEND=upstash', () => {
    process.env.STORE_BACKEND = 'upstash';
    resetStoreForTests();
    expect((getStore() as any).kind).toBe('upstash');
  });
});
