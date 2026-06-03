// api/_lib/store/firestoreStore.ts
import { Firestore } from '@google-cloud/firestore';
import type { AppStore, AccessEvent, HistoryItem, JobLease, RateLimitOutcome } from './types.js';
import type { JobRecord } from '../jobStore.js';

type Clock = () => Date;

// Firestore doc ids cannot contain '/'. Encode arbitrary keys safely.
function encodeId(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

export class FirestoreStore implements AppStore {
  private db: Firestore;
  private now: Clock;

  constructor(db?: Firestore, now: Clock = () => new Date()) {
    // No-arg construction uses Application Default Credentials (the Cloud Run service account).
    this.db =
      db ??
      new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || undefined,
        databaseId: process.env.FIRESTORE_DATABASE_ID || '(default)'
      });
    this.now = now;
  }

  isConfigured(): boolean {
    return true; // Auth is ambient via the service account; nothing to validate up front.
  }

  private nowMs(): number {
    return this.now().getTime();
  }

  private notExpired(data: any): boolean {
    if (!data) return false;
    if (typeof data.expiresAtMs !== 'number') return true;
    return data.expiresAtMs > this.nowMs();
  }

  async hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(this.nowMs() / windowMs) * windowMs;
    const ref = this.db.collection('rateLimits').doc(encodeId(`${key}__${windowStart}`));
    const count = await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? Number(snap.data()?.count || 0) : 0;
      const next = current + 1;
      tx.set(ref, { count: next, expiresAtMs: windowStart + windowMs });
      return next;
    });
    return { allowed: count <= limit, count };
  }

  async setDemoCode(normalizedCode: string, uses: number): Promise<void> {
    await this.db.collection('demoCodes').doc(encodeId(normalizedCode)).set({ code: normalizedCode, remaining: uses });
  }

  async getDemoRemaining(normalizedCode: string): Promise<number | null> {
    const snap = await this.db.collection('demoCodes').doc(encodeId(normalizedCode)).get();
    if (!snap.exists) return null;
    const remaining = snap.data()?.remaining;
    return typeof remaining === 'number' ? remaining : null;
  }

  async consumeDemoCode(normalizedCode: string): Promise<number | null> {
    const ref = this.db.collection('demoCodes').doc(encodeId(normalizedCode));
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const current = Number(snap.data()?.remaining);
      if (!Number.isFinite(current)) return null;
      const next = current - 1;
      if (next < 0) {
        tx.set(ref, { code: normalizedCode, remaining: 0 });
        return null;
      }
      tx.set(ref, { code: normalizedCode, remaining: next });
      return next;
    });
  }

  async revokeDemoCode(normalizedCode: string): Promise<void> {
    await this.db.collection('demoCodes').doc(encodeId(normalizedCode)).delete();
  }

  async listDemoCodes(): Promise<Array<{ code: string; remaining: number }>> {
    const snap = await this.db.collection('demoCodes').get();
    const results: Array<{ code: string; remaining: number }> = [];
    snap.forEach((doc) => {
      const d = doc.data();
      if (typeof d?.remaining === 'number' && typeof d?.code === 'string') {
        results.push({ code: d.code, remaining: d.remaining });
      }
    });
    return results.sort((a, b) => a.code.localeCompare(b.code));
  }

  async appendEvent(event: AccessEvent, cap: number): Promise<void> {
    const col = this.db.collection('auditEvents');
    await col.add({ ...event, _ts: this.nowMs() });
    const overflow = await col.orderBy('_ts', 'desc').offset(cap).get();
    await Promise.all(overflow.docs.map((d) => d.ref.delete()));
  }

  async listEvents(limit: number): Promise<AccessEvent[]> {
    const snap = await this.db.collection('auditEvents').orderBy('_ts', 'desc').limit(limit).get();
    return snap.docs.map((d) => {
      const { _ts, ...rest } = d.data() as any;
      return rest as AccessEvent;
    });
  }

  async setJob(job: JobRecord, ttlSeconds: number): Promise<void> {
    await this.db
      .collection('jobs')
      .doc(encodeId(job.id))
      .set({ job, expiresAtMs: this.nowMs() + ttlSeconds * 1000 });
  }

  async getJob(jobId: string): Promise<JobRecord | null> {
    const snap = await this.db.collection('jobs').doc(encodeId(jobId)).get();
    const data = snap.exists ? snap.data() : null;
    if (!this.notExpired(data)) return null;
    return (data?.job as JobRecord) ?? null;
  }

  async setActiveJob(scopeKey: string, jobId: string, ttlSeconds: number): Promise<void> {
    await this.db
      .collection('activeJobs')
      .doc(encodeId(scopeKey))
      .set({ jobId, expiresAtMs: this.nowMs() + ttlSeconds * 1000 });
  }

  async getActiveJob(scopeKey: string): Promise<string | null> {
    const snap = await this.db.collection('activeJobs').doc(encodeId(scopeKey)).get();
    const data = snap.exists ? snap.data() : null;
    if (!this.notExpired(data)) return null;
    const jobId = data?.jobId;
    return typeof jobId === 'string' && jobId ? jobId : null;
  }

  async clearActiveJob(scopeKey: string, expectedJobId?: string): Promise<void> {
    const ref = this.db.collection('activeJobs').doc(encodeId(scopeKey));
    if (expectedJobId) {
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.jobId !== expectedJobId) return;
    }
    await ref.delete();
  }

  async acquireLease(jobId: string, owner: string, ttlSeconds: number): Promise<JobLease | null> {
    const ref = this.db.collection('jobLeases').doc(encodeId(jobId));
    const expiresAtMs = this.nowMs() + ttlSeconds * 1000;
    const lease: JobLease = { owner, expiresAt: new Date(expiresAtMs).toISOString() };
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      if (data && this.notExpired(data)) return null;
      tx.set(ref, { ...lease, expiresAtMs });
      return lease;
    });
  }

  async getLease(jobId: string): Promise<JobLease | null> {
    const snap = await this.db.collection('jobLeases').doc(encodeId(jobId)).get();
    const data = snap.exists ? snap.data() : null;
    if (!this.notExpired(data)) return null;
    return { owner: data!.owner, expiresAt: data!.expiresAt };
  }

  async releaseLease(jobId: string, expectedOwner?: string): Promise<void> {
    const ref = this.db.collection('jobLeases').doc(encodeId(jobId));
    if (expectedOwner) {
      const snap = await ref.get();
      if (!snap.exists || snap.data()?.owner !== expectedOwner) return;
    }
    await ref.delete();
  }

  async appendHistory(scopeKey: string, item: HistoryItem, cap: number): Promise<void> {
    const col = this.db.collection('jobHistory').doc(encodeId(scopeKey)).collection('items');
    await col.add({ ...item, _ts: this.nowMs() });
    const overflow = await col.orderBy('_ts', 'desc').offset(cap).get();
    await Promise.all(overflow.docs.map((d) => d.ref.delete()));
  }

  async listHistory(scopeKey: string, limit: number): Promise<HistoryItem[]> {
    const col = this.db.collection('jobHistory').doc(encodeId(scopeKey)).collection('items');
    const snap = await col.orderBy('_ts', 'desc').limit(limit).get();
    return snap.docs.map((d) => {
      const { _ts, ...rest } = d.data() as any;
      return rest as HistoryItem;
    });
  }
}
