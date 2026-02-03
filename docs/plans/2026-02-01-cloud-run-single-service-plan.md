# Cloud Run Single Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Serve the Vite UI and all `/api/*` endpoints from a single Cloud Run service without rewriting existing handler logic.

**Architecture:** Add a Node server that serves `dist/` and adapts Node requests to existing Vercel-style handlers. Build and run the server inside a Cloud Run Docker image.

**Tech Stack:** Node 18, TypeScript, Vite build output, existing API handlers, Cloud Run Docker.

---

### Task 1: Fix failing baseline tests for process status response headers

**Files:**
- Modify: `tests/api/processStatus.test.ts`

**Step 1: Write the failing test update**

Add a `setHeader` stub to the mock response so `res.setHeader` exists.

```ts
const createRes = () => {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
  return res as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
};
```

**Step 2: Run the test to verify it fails without the change**

Run: `npx vitest run tests/api/processStatus.test.ts`
Expected: FAIL with `res.setHeader is not a function`

**Step 3: Apply the minimal change**

Insert the `setHeader` stub as shown above.

**Step 4: Run the test again**

Run: `npx vitest run tests/api/processStatus.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/api/processStatus.test.ts
git commit -m "test: add setHeader to process status mock"
```

---

### Task 2: Add a server-side adapter to run Vercel handlers on Cloud Run

**Files:**
- Create: `server/adapter.ts`
- Test: `tests/server/adapter.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildVercelRequest } from '../../server/adapter';

it('builds query and body from node request', async () => {
  const req = new Request('http://localhost/api/process?jobId=123', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ demoCode: 'ABC' })
  });

  const { vercelRequest } = await buildVercelRequest(req);

  expect(vercelRequest.method).toBe('POST');
  expect(vercelRequest.query.jobId).toBe('123');
  expect(vercelRequest.body.demoCode).toBe('ABC');
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/adapter.test.ts`
Expected: FAIL because `buildVercelRequest` does not exist.

**Step 3: Implement minimal adapter**

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export async function buildVercelRequest(req: Request) {
  const url = new URL(req.url);
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: unknown = undefined;
  const contentType = req.headers.get('content-type') || '';
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      body = await req.text();
    }
  }

  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const vercelRequest = {
    method: req.method,
    headers,
    query,
    body
  } as VercelRequest;

  return { vercelRequest };
}

export function createVercelResponse(res: Response) {
  const headers: Record<string, string> = {};
  const vercelResponse = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(key: string, value: string) {
      headers[key] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  } as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> };

  return { vercelResponse, headers };
}
```

**Step 4: Run the test**

Run: `npx vitest run tests/server/adapter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/adapter.ts tests/server/adapter.test.ts
git commit -m "feat: add cloud run adapter helpers"
```

---

### Task 3: Add Cloud Run server entrypoint

**Files:**
- Create: `server/index.ts`
- Test: `tests/server/serverRoutes.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { resolveStaticPath } from '../../server/index';

describe('resolveStaticPath', () => {
  it('maps / to index.html', () => {
    expect(resolveStaticPath('/')).toContain('index.html');
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/server/serverRoutes.test.ts`
Expected: FAIL because `resolveStaticPath` does not exist.

**Step 3: Implement the server**

```ts
import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildVercelRequest, createVercelResponse } from './adapter';
import processHandler from '../api/process';
import chatHandler from '../api/chat';
import demoValidateHandler from '../api/demo/validate';
import blobDeleteHandler from '../api/blob/delete';
import adminGenerateHandler from '../api/admin/generate';
import adminRevokeHandler from '../api/admin/revoke';
import adminEventsHandler from '../api/admin/events';
import adminStatsHandler from '../api/admin/stats';
import adminPurgeHandler from '../api/admin/purge';
import adminVerifyHandler from '../api/admin/verify';
import adminListHandler from '../api/admin/list';

const distDir = path.join(process.cwd(), 'dist');

export function resolveStaticPath(urlPath: string) {
  if (urlPath === '/' || urlPath === '') return path.join(distDir, 'index.html');
  return path.join(distDir, urlPath.replace(/^\//, ''));
}

const apiRoutes: Record<string, typeof processHandler> = {
  '/api/process': processHandler,
  '/api/chat': chatHandler,
  '/api/demo/validate': demoValidateHandler,
  '/api/blob/delete': blobDeleteHandler,
  '/api/admin/generate': adminGenerateHandler,
  '/api/admin/revoke': adminRevokeHandler,
  '/api/admin/events': adminEventsHandler,
  '/api/admin/stats': adminStatsHandler,
  '/api/admin/purge': adminPurgeHandler,
  '/api/admin/verify': adminVerifyHandler,
  '/api/admin/list': adminListHandler
};

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const handler = apiRoutes[url.pathname];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
    return;
  }

  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(Buffer.from(chunk));
  }
  const bodyString = bodyChunks.length ? Buffer.concat(bodyChunks).toString('utf8') : undefined;
  const request = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: bodyString
  });

  const { vercelRequest } = await buildVercelRequest(request);
  const { vercelResponse, headers } = createVercelResponse(new Response());

  await handler(vercelRequest, vercelResponse);

  res.writeHead(vercelResponse.statusCode, {
    'Content-Type': 'application/json',
    ...headers
  });
  res.end(JSON.stringify(vercelResponse.body ?? {}));
}

async function handleStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const urlPath = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const filePath = resolveStaticPath(urlPath);

  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const data = await fs.readFile(filePath);
      res.writeHead(200);
      res.end(data);
      return;
    }
  } catch (error) {
    // fallthrough to index
  }

  const indexPath = path.join(distDir, 'index.html');
  const index = await fs.readFile(indexPath);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(index);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  if (urlPath.startsWith('/api/')) {
    await handleApi(req, res);
    return;
  }
  await handleStatic(req, res);
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => {
  console.log(`Server listening on ${port}`);
});
```

**Step 4: Run the test**

Run: `npx vitest run tests/server/serverRoutes.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add server/index.ts tests/server/serverRoutes.test.ts
git commit -m "feat: add cloud run server entrypoint"
```

---

### Task 4: Add Cloud Run build scripts and Dockerfile

**Files:**
- Create: `cloudrun/Dockerfile`
- Modify: `package.json`
- Create: `server/tsconfig.json`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

it('cloud run Dockerfile exists', async () => {
  const dockerfile = await readFile(path.join(process.cwd(), 'cloudrun/Dockerfile'), 'utf8');
  expect(dockerfile).toContain('npm run build');
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/server/dockerfile.test.ts`
Expected: FAIL because `cloudrun/Dockerfile` does not exist.

**Step 3: Implement Dockerfile and scripts**

`cloudrun/Dockerfile`:

```Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN npx tsc -p server/tsconfig.json

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server/dist/index.js"]
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "noEmit": false
  },
  "include": ["index.ts", "adapter.ts"],
  "exclude": ["../node_modules"]
}
```

`package.json` script additions:

```json
"scripts": {
  "build:server": "tsc -p server/tsconfig.json"
}
```

**Step 4: Run the test**

Run: `npx vitest run tests/server/dockerfile.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add cloudrun/Dockerfile server/tsconfig.json package.json tests/server/dockerfile.test.ts
git commit -m "feat: add cloud run build output"
```

---

### Task 5: End-to-end verification

**Files:**
- None

**Step 1: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 2: Build image locally (optional)**

Run: `docker build -f cloudrun/Dockerfile .`
Expected: build succeeds

**Step 3: Commit any remaining changes**

```bash
git status -sb
git add -A
git commit -m "feat: cloud run single service" || true
```

---

## Deployment Checklist (Cloud Run)

1. `gcloud builds submit --tag gcr.io/<PROJECT_ID>/lecturemate-app -f cloudrun/Dockerfile .`
2. `gcloud run deploy lecturemate-app --image gcr.io/<PROJECT_ID>/lecturemate-app --region us-central1 --allow-unauthenticated --memory 4Gi --timeout 3600`
3. Set env vars in Cloud Run service configuration:
   - `GEMINI_API_KEY`
   - `SYSTEM_INSTRUCTIONS`
   - `BLOB_READ_WRITE_TOKEN`
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
   - `ADMIN_PASSWORD`
   - `WORKER_SHARED_SECRET` only if still used

---

**Plan complete and saved to** `docs/plans/2026-02-01-cloud-run-single-service-plan.md`.

Two execution options:

1. **Subagent-Driven (this session)**, I dispatch a fresh subagent per task and review between tasks.
2. **Parallel Session**, open a new session and run `superpowers:executing-plans` with the plan.

Which approach.
