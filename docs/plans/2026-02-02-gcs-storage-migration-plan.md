# GCS Storage Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Vercel Blob storage with Google Cloud Storage signed uploads while preserving existing job flow, admin purge, and worker cleanup.

**Architecture:** Add GCS helper module for signed upload URLs, reads, and deletes; update upload endpoint to return signed URLs; store only object names in KV; worker downloads from GCS and writes result to GCS; admin purge lists/deletes GCS objects.

**Tech Stack:** Node.js, @google-cloud/storage, Vercel-style API handlers, Upstash KV, Vitest.

---

### Task 1: Add GCS helper utilities

**Files:**
- Create: `api/_lib/gcs.ts`
- Test: `tests/api/gcsHelpers.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildUploadObjectName, buildResultObjectName, parseBucketEnv } from '../../api/_lib/gcs';

describe('gcs helpers', () => {
  it('builds upload object names with jobId prefix', () => {
    const name = buildUploadObjectName('job-1', 'audio.mp3');
    expect(name).toMatch(/^uploads\/job-1\//);
  });

  it('builds result object names', () => {
    const name = buildResultObjectName('job-1');
    expect(name).toBe('results/job-1/study-guide.md');
  });

  it('throws when GCS_BUCKET is missing', () => {
    delete process.env.GCS_BUCKET;
    expect(() => parseBucketEnv()).toThrow('GCS_BUCKET');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/gcsHelpers.test.ts`
Expected: FAIL with module not found.

**Step 3: Write minimal implementation**

```ts
import { Storage } from '@google-cloud/storage';

export const parseBucketEnv = () => {
  const bucket = process.env.GCS_BUCKET;
  if (!bucket) throw new Error('GCS_BUCKET is required');
  return bucket;
};

export const buildUploadObjectName = (jobId: string, filename: string) => {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `uploads/${jobId}/${Date.now()}-${safeName}`;
};

export const buildResultObjectName = (jobId: string) => `results/${jobId}/study-guide.md`;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/gcsHelpers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/_lib/gcs.ts tests/api/gcsHelpers.test.ts
 git commit -m "feat: add gcs helper utilities"
```

---

### Task 2: Signed upload endpoint

**Files:**
- Create: `api/gcs/upload-url.ts`
- Modify: `api/_lib/access.ts`
- Test: `tests/api/gcsUploadUrl.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import handler from '../../api/gcs/upload-url';

vi.mock('../../api/_lib/access', () => ({ authorizeUpload: vi.fn() }));

it('returns uploadUrl and objectName', async () => {
  const request = new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({ filename: 'audio.mp3', mimeType: 'audio/mp3', jobId: 'job-1' })
  });
  const response = await handler(request as any);
  const json = await response.json();
  expect(json.uploadUrl).toBeTruthy();
  expect(json.objectName).toContain('uploads/job-1');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/gcsUploadUrl.test.ts`
Expected: FAIL.

**Step 3: Implement upload-url endpoint**

```ts
import { authorizeUpload } from '../_lib/access';
import { createSignedUploadUrl, buildUploadObjectName } from '../_lib/gcs';

export default async function handler(req: Request) {
  const { filename, mimeType, jobId } = await req.json();
  authorizeUpload(req);
  const objectName = buildUploadObjectName(jobId, filename);
  const uploadUrl = await createSignedUploadUrl(objectName, mimeType);
  return new Response(JSON.stringify({ uploadUrl, objectName }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Step 4: Run test**

Run: `npx vitest run tests/api/gcsUploadUrl.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add api/gcs/upload-url.ts api/_lib/access.ts tests/api/gcsUploadUrl.test.ts
 git commit -m "feat: add gcs signed upload endpoint"
```

---

### Task 3: Replace Blob usage in backend/worker

**Files:**
- Modify: `api/_lib/resultStorage.ts`
- Modify: `api/_lib/blobCleanup.ts` (or replace with gcs cleanup)
- Modify: `api/_lib/blobAdmin.ts`
- Modify: `api/_lib/gemini.ts`
- Modify: `worker/handler.ts`
- Modify: `api/process/index.ts`
- Tests: `tests/api/resultStorage.test.ts`, `tests/api/blobDelete.test.ts`, `tests/api/blobAdmin.test.ts`, `tests/worker/workerRun.test.ts`

**Step 1: Write failing tests**
- Update tests to expect object names instead of URLs.
- Update purge tests to mock GCS list/delete instead of Blob.

**Step 2: Run tests**

Run: `npx vitest run tests/api/resultStorage.test.ts tests/api/blobAdmin.test.ts tests/worker/workerRun.test.ts`
Expected: FAIL.

**Step 3: Implement GCS in code**
- `resultStorage` should write to `results/<jobId>/study-guide.md` using GCS SDK.
- Worker downloads `uploads/...` object via GCS SDK.
- Cleanup deletes `uploads/...` after processing and results on purge.

**Step 4: Run tests**
Expected: PASS.

**Step 5: Commit**

```bash
git add api/_lib/resultStorage.ts api/_lib/blobAdmin.ts api/_lib/gemini.ts worker/handler.ts api/process/index.ts tests/api/resultStorage.test.ts tests/api/blobAdmin.test.ts tests/worker/workerRun.test.ts
 git commit -m "feat: switch processing and purge to gcs"
```

---

### Task 4: Frontend upload wiring

**Files:**
- Modify: `services/geminiService.ts`
- Modify: `services/cleanupUploadedFiles.ts`
- Tests: `tests/services/analyzeAudioLecture.test.ts`, `tests/services/cleanupUploadedFiles.test.ts`

**Step 1: Update tests for objectName flow**

**Step 2: Run tests**

Run: `npx vitest run tests/services/analyzeAudioLecture.test.ts tests/services/cleanupUploadedFiles.test.ts`
Expected: FAIL.

**Step 3: Update implementation**
- Request signed URL from `/api/gcs/upload-url`.
- `PUT` file to GCS.
- Send `objectName` to `/api/process`.
- Cleanup should call `/api/blob/delete` with `objects`.

**Step 4: Run tests**
Expected: PASS.

**Step 5: Commit**

```bash
git add services/geminiService.ts services/cleanupUploadedFiles.ts tests/services/analyzeAudioLecture.test.ts tests/services/cleanupUploadedFiles.test.ts
 git commit -m "feat: use gcs signed uploads in frontend"
```

---

### Task 5: Add GCS dependency and update env docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Step 1: Add dependency**

```bash
npm install @google-cloud/storage
```

**Step 2: Update README**
- Add `GCS_BUCKET`, `GCS_UPLOAD_URL_TTL_SECONDS`, `GCS_RESULT_URL_TTL_SECONDS`.
- Note removal of Vercel Blob for storage.

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS.

**Step 4: Commit**

```bash
git add package.json package-lock.json README.md
 git commit -m "chore: add gcs storage dependency and docs"
```

---

### Task 6: Final verification and push

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS.

**Step 2: Push branch**

```bash
git push -u origin gcs-storage-migration
```

---

Plan complete and saved to `docs/plans/2026-02-02-gcs-storage-migration-plan.md`.

Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task and review between tasks.
2. Parallel Session (separate) - Open a new session and run superpowers:executing-plans step-by-step.

Which approach?
