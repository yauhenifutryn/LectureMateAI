// api/_lib/store/index.ts
import type { AppStore } from './types.js';
import { FirestoreStore } from './firestoreStore.js';
import { UpstashStore } from './upstashStore.js';

let cached: AppStore | null = null;

export function getStore(): AppStore {
  if (cached) return cached;
  const backend = (process.env.STORE_BACKEND || 'firestore').toLowerCase();
  cached = backend === 'upstash' ? new UpstashStore() : new FirestoreStore();
  return cached;
}

export function resetStoreForTests(): void {
  cached = null;
}

export type { AppStore } from './types.js';
