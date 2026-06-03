// tests/store/firestoreStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirestoreStore } from '../../api/_lib/store/firestoreStore';

// Minimal in-memory fake of the subset of the Firestore API we use.
function makeFakeFirestore() {
  const data = new Map<string, any>();
  const docRef = (path: string) => ({
    path,
    async get() {
      const exists = data.has(path);
      return { exists, data: () => data.get(path) };
    },
    async set(value: any) {
      data.set(path, value);
    },
    async delete() {
      data.delete(path);
    }
  });
  const collection = (name: string) => ({
    doc: (id: string) => docRef(`${name}/${id}`),
    async add(value: any) {
      const id = `auto-${data.size}`;
      data.set(`${name}/${id}`, value);
      return docRef(`${name}/${id}`);
    }
  });
  const db: any = {
    _data: data,
    collection,
    doc: (path: string) => docRef(path),
    async runTransaction(fn: any) {
      const tx = {
        async get(ref: any) {
          return ref.get();
        },
        set(ref: any, value: any) {
          data.set(ref.path, value);
        },
        delete(ref: any) {
          data.delete(ref.path);
        }
      };
      return fn(tx);
    }
  };
  return db;
}

describe('FirestoreStore', () => {
  let db: any;
  let store: FirestoreStore;

  beforeEach(() => {
    db = makeFakeFirestore();
    store = new FirestoreStore(db, () => new Date('2026-06-03T00:00:00.000Z'));
  });

  it('hitRateLimit counts within a fixed window', async () => {
    const a = await store.hitRateLimit('admin-verify:1.2.3.4', 2, 60);
    const b = await store.hitRateLimit('admin-verify:1.2.3.4', 2, 60);
    const c = await store.hitRateLimit('admin-verify:1.2.3.4', 2, 60);
    expect(a).toEqual({ allowed: true, count: 1 });
    expect(b).toEqual({ allowed: true, count: 2 });
    expect(c).toEqual({ allowed: false, count: 3 });
  });

  it('stores and consumes a demo code, flooring at zero', async () => {
    await store.setDemoCode('ABC', 1);
    expect(await store.getDemoRemaining('ABC')).toBe(1);
    expect(await store.consumeDemoCode('ABC')).toBe(0);
    expect(await store.consumeDemoCode('ABC')).toBeNull();
  });

  it('acquireLease is exclusive until released', async () => {
    const first = await store.acquireLease('job1', 'ownerA', 60);
    const second = await store.acquireLease('job1', 'ownerB', 60);
    expect(first?.owner).toBe('ownerA');
    expect(second).toBeNull();
    await store.releaseLease('job1', 'ownerA');
    const third = await store.acquireLease('job1', 'ownerB', 60);
    expect(third?.owner).toBe('ownerB');
  });

  it('treats expired docs as absent on read', async () => {
    store = new FirestoreStore(db, () => new Date('2026-06-03T00:00:00.000Z'));
    await store.setActiveJob('active:demo:ABC', 'job1', 60);
    // advance the clock past the TTL
    store = new FirestoreStore(db, () => new Date('2026-06-03T01:00:00.000Z'));
    expect(await store.getActiveJob('active:demo:ABC')).toBeNull();
  });
});
