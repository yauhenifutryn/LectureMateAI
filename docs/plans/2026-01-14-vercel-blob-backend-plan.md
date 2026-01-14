# Vercel Blob Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Vercel Blob backed serverless endpoints for Gemini processing and chat, refactor the frontend to use them, and remove client side API key exposure.

**Architecture:** Frontend uploads audio and slides to Vercel Blob using a scoped token from `/api/upload`, then calls `/api/process` with Blob URLs and metadata. The backend validates Blob URLs, downloads files, uploads to Gemini, generates the study guide and transcript, then deletes both Gemini files and Blob objects in `finally`. Chat routes through `/api/chat` using transcript, study guide, and chat history.

**Tech Stack:** Vite React, Vercel Serverless Functions, `@vercel/blob`, `@vercel/blob/client`, `@google/genai`, Vitest.

## Task 1: Add dependencies and test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Step 1: Add dependencies and test script**

Update `package.json`.

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@vercel/blob": "^0.27.0",
    "dotenv": "^16.4.7"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

**Step 2: Add Vitest config**

Create `vitest.config.ts`.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node'
  }
});
```

**Step 3: Install dependencies**

Run: `npm install`
Expected: exit 0, dependencies installed.

**Step 4: Run tests to verify setup**

Run: `npm test`
Expected: exits 0, zero tests found.

**Step 5: Commit**

```bash
git add package.json vitest.config.ts package-lock.json
git commit -m "chore: add vitest and backend deps"
```

## Task 2: Add prompts, validation, and error helpers

**Files:**
- Create: `api/_lib/prompts.ts`
- Create: `api/_lib/validateBlobUrl.ts`
- Create: `api/_lib/errors.ts`
- Create: `tests/api/validateBlobUrl.test.ts`

**Step 1: Write failing tests**

Create `tests/api/validateBlobUrl.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { validateBlobUrl } from '../../api/_lib/validateBlobUrl';

describe('validateBlobUrl', () => {
  it('accepts vercel blob host with allowed prefix', () => {
    const url = 'https://public.blob.vercel-storage.com/lecture/file.mp3';
    expect(() => validateBlobUrl(url, 'https://public.blob.vercel-storage.com/lecture/')).not.toThrow();
  });

  it('rejects non vercel blob hosts', () => {
    const url = 'https://example.com/file.mp3';
    expect(() => validateBlobUrl(url)).toThrow(/invalid blob host/i);
  });

  it('rejects url outside allowed prefix when provided', () => {
    const url = 'https://public.blob.vercel-storage.com/other/file.mp3';
    expect(() => validateBlobUrl(url, 'https://public.blob.vercel-storage.com/lecture/')).toThrow(/invalid blob prefix/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Cannot find module '../../api/_lib/validateBlobUrl'".

**Step 3: Write minimal implementation**

Create `api/_lib/validateBlobUrl.ts`.

```ts
export function validateBlobUrl(fileUrl: string, allowedPrefix?: string): URL {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    throw new Error('Invalid blob URL.');
  }

  if (!url.hostname.endsWith('.blob.vercel-storage.com')) {
    throw new Error('Invalid blob host.');
  }

  if (allowedPrefix && !fileUrl.startsWith(allowedPrefix)) {
    throw new Error('Invalid blob prefix.');
  }

  return url;
}
```

Create `api/_lib/errors.ts`.

```ts
export type PublicError = {
  code: string;
  message: string;
};

export function toPublicError(error: unknown): PublicError {
  const message = error instanceof Error ? error.message : 'Unknown error.';
  const lower = message.toLowerCase();
  if (lower.includes('payload too large')) return { code: 'payload_too_large', message };
  if (lower.includes('invalid blob')) return { code: 'invalid_blob_url', message };
  return { code: 'internal_error', message: 'Processing failed. Please retry.' };
}
```

Create `api/_lib/prompts.ts`.

```ts
export const SYSTEM_INSTRUCTION = `...`; // Master Tutor system prompt

export const CHAT_SYSTEM_INSTRUCTION = `...`; // Chat follow up prompt
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add api/_lib/validateBlobUrl.ts api/_lib/errors.ts api/_lib/prompts.ts tests/api/validateBlobUrl.test.ts
git commit -m "feat: add backend helpers and prompts"
```

## Task 3: Implement `/api/upload` endpoint

**Files:**
- Create: `api/upload.ts`
- Create: `tests/api/upload.test.ts`

**Step 1: Write a minimal contract test**

Create `tests/api/upload.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { buildUploadConfig } from '../../api/upload';

describe('buildUploadConfig', () => {
  it('limits content types and size', () => {
    const config = buildUploadConfig();
    expect(config.allowedContentTypes.length).toBeGreaterThan(0);
    expect(config.maxFileSize).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with "Module '../../api/upload' has no exported member 'buildUploadConfig'".

**Step 3: Implement endpoint and helper**

Create `api/upload.ts`.

```ts
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export const config = { runtime: 'edge' };

export function buildUploadConfig() {
  return {
    allowedContentTypes: [
      'audio/mpeg',
      'audio/mp4',
      'audio/wav',
      'audio/webm',
      'audio/x-m4a',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'application/pdf'
    ],
    maxFileSize: 1024 * 1024 * 1024
  };
}

export default async function handler(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  const { allowedContentTypes, maxFileSize } = buildUploadConfig();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith('lectures/')) {
          throw new Error('Invalid upload path.');
        }
        return {
          allowedContentTypes,
          maximumSize: maxFileSize,
          tokenPayload: JSON.stringify({ scope: 'lecture-upload' })
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.log('Upload completed:', blob.url);
      }
    });

    return new Response(JSON.stringify(jsonResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add api/upload.ts tests/api/upload.test.ts
git commit -m "feat: add vercel blob upload endpoint"
```

## Task 4: Implement `/api/process` endpoint with Gemini and cleanup

**Files:**
- Create: `api/process.ts`
- Create: `api/_lib/gemini.ts`

**Step 1: Write failing tests for error mapping**

Create `tests/api/process-errors.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { toPublicError } from '../../api/_lib/errors';

describe('toPublicError', () => {
  it('maps payload too large', () => {
    const err = new Error('Payload Too Large');
    expect(toPublicError(err).code).toBe('payload_too_large');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: PASS because helper already exists.

**Step 3: Implement Gemini helper**

Create `api/_lib/gemini.ts`.

```ts
import { GoogleGenAI } from '@google/genai';

export async function uploadAndGenerate({
  apiKey,
  systemInstruction,
  promptText,
  files
}: {
  apiKey: string;
  systemInstruction: string;
  promptText: string;
  files: Array<{ buffer: Buffer; mimeType: string; displayName: string }>;
}) {
  const ai = new GoogleGenAI({ apiKey });
  const uploaded = [] as Array<{ name: string; uri: string; mimeType: string }>;

  try {
    for (const file of files) {
      const res = await ai.files.upload({
        file: new Blob([file.buffer], { type: file.mimeType }),
        config: { displayName: file.displayName, mimeType: file.mimeType }
      });
      const uploadedFile = (res as any).file || res;
      uploaded.push({ name: uploadedFile.name, uri: uploadedFile.uri, mimeType: uploadedFile.mimeType });
    }

    const parts = uploaded.map((file) => ({
      fileData: { fileUri: file.uri, mimeType: file.mimeType }
    }));

    parts.push({ text: promptText });

    const stream = await ai.models.generateContentStream({
      model: 'gemini-3-flash-preview',
      contents: { parts },
      config: { systemInstruction, temperature: 0.2 }
    });

    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.text) fullText += chunk.text;
    }

    return { fullText, uploaded };
  } finally {
    for (const file of uploaded) {
      await ai.files.delete({ name: file.name });
    }
  }
}
```

**Step 4: Implement process endpoint**

Create `api/process.ts`.

```ts
import 'dotenv/config';
import { del } from '@vercel/blob';
import { validateBlobUrl } from './_lib/validateBlobUrl';
import { toPublicError } from './_lib/errors';
import { uploadAndGenerate } from './_lib/gemini';
import { SYSTEM_INSTRUCTION } from './_lib/prompts';

export const config = { maxDuration: 60 };

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'POST required.' } }), { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { code: 'missing_api_key', message: 'Server misconfigured.' } }), { status: 500 });
  }

  const { audio, slides = [], userContext } = await request.json();
  const blobPrefix = process.env.BLOB_URL_PREFIX;
  const blobUrls: string[] = [];

  try {
    if (!audio?.fileUrl || !audio?.mimeType) throw new Error('Missing audio payload.');

    const allFiles = [audio, ...slides];
    const downloads = await Promise.all(allFiles.map(async (file: any, index: number) => {
      validateBlobUrl(file.fileUrl, blobPrefix);
      blobUrls.push(file.fileUrl);
      const response = await fetch(file.fileUrl);
      if (!response.ok) throw new Error('Blob download failed.');
      const buffer = Buffer.from(await response.arrayBuffer());
      const displayName = index === 0 ? 'lecture-audio' : `lecture-slide-${index}`;
      return { buffer, mimeType: file.mimeType, displayName };
    }));

    const promptText = `I have attached ${slides.length > 0 ? slides.length + ' lecture slide file(s) and the lecture audio.' : 'the lecture audio.'}\n\nStudent\'s Additional Context:\n${userContext || 'None provided.'}\n\nGenerate the output using the strict separators defined in the System Instructions.`;

    const { fullText } = await uploadAndGenerate({
      apiKey,
      systemInstruction: SYSTEM_INSTRUCTION,
      promptText,
      files: downloads
    });

    return new Response(JSON.stringify({ text: fullText }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return new Response(JSON.stringify({ error: publicError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    await Promise.all(blobUrls.map((url) => del(url).catch(() => null)));
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

**Step 6: Commit**

```bash
git add api/process.ts api/_lib/gemini.ts tests/api/process-errors.test.ts
git commit -m "feat: add gemini processing endpoint"
```

## Task 5: Implement `/api/chat` endpoint

**Files:**
- Create: `api/chat.ts`

**Step 1: Implement endpoint**

Create `api/chat.ts`.

```ts
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { toPublicError } from './_lib/errors';
import { CHAT_SYSTEM_INSTRUCTION } from './_lib/prompts';

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'POST required.' } }), { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { code: 'missing_api_key', message: 'Server misconfigured.' } }), { status: 500 });
  }

  try {
    const { transcript, studyGuide, messages } = await request.json();
    if (!transcript || !studyGuide || !Array.isArray(messages)) {
      throw new Error('Missing chat payload.');
    }

    const ai = new GoogleGenAI({ apiKey });
    const history = [
      {
        role: 'user',
        parts: [{ text: `Here is the verbatim transcript of the lecture I want to discuss:\n${transcript}\n\nHere is the Study Guide you generated:\n${studyGuide}` }]
      },
      ...messages.map((msg: any) => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      }))
    ];

    const model = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history,
      config: { systemInstruction: CHAT_SYSTEM_INSTRUCTION, temperature: 0.3 }
    });

    const result = await model.sendMessage({ message: '' });
    const reply = result.text || '';

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return new Response(JSON.stringify({ error: publicError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
```

**Step 2: Run tests**

Run: `npm test`
Expected: PASS.

**Step 3: Commit**

```bash
git add api/chat.ts
git commit -m "feat: add chat endpoint"
```

## Task 6: Refactor frontend Gemini service and chat session

**Files:**
- Modify: `services/geminiService.ts`
- Modify: `types.ts`
- Modify: `App.tsx`
- Modify: `components/ChatInterface.tsx`
- Create: `tests/services/parseResponseText.test.ts`

**Step 1: Write a focused unit test for response parsing**

Create `tests/services/parseResponseText.test.ts`.

```ts
import { describe, it, expect } from 'vitest';
import { parseResponseText } from '../../services/geminiService';

describe('parseResponseText', () => {
  it('splits guide and transcript', () => {
    const raw = '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript';
    const { studyGuide, transcript } = parseResponseText(raw);
    expect(studyGuide).toBe('Guide');
    expect(transcript).toBe('Transcript');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL if `parseResponseText` is not exported.

**Step 3: Update `services/geminiService.ts`**

- Remove `@google/genai` imports and direct API key usage.
- Add `upload` from `@vercel/blob/client`.
- Upload audio and slides via `/api/upload` with `lectures/<id>-<name>` pathnames.
- Send `{ audio, slides, userContext }` to `/api/process`.
- Parse `text` into `{ studyGuide, transcript }` using existing logic.
- Replace `initializeChatSession` with a backend chat session wrapper that stores history and calls `/api/chat`.

**Step 4: Update shared types and chat UI**

- Add `ChatSession` interface to `types.ts` with `sendMessageStream` signature.
- Replace `@google/genai` `Chat` type usage in `App.tsx` and `components/ChatInterface.tsx` with `ChatSession`.

**Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

**Step 6: Commit**

```bash
git add services/geminiService.ts types.ts App.tsx components/ChatInterface.tsx tests/services/parseResponseText.test.ts
git commit -m "refactor: route gemini calls through backend"
```

## Task 7: Remove API key exposure and document env vars

**Files:**
- Modify: `vite.config.ts`
- Modify: `README.md`

**Step 1: Update Vite config to remove key injection**

Remove `define: { 'process.env.API_KEY': ..., 'process.env.GEMINI_API_KEY': ... }`.

**Step 2: Update README env section**

Document `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, and optional `BLOB_URL_PREFIX` as backend only variables.

**Step 3: Run tests**

Run: `npm test`
Expected: PASS.

**Step 4: Commit**

```bash
git add vite.config.ts README.md
git commit -m "docs: update env and remove client key injection"
```

---

Plan complete and saved to `docs/plans/2026-01-14-vercel-blob-backend-plan.md`.

Two execution options:

1. Subagent Driven (this session): I dispatch a fresh subagent per task, review between tasks.
2. Parallel Session: Open a new session and run `superpowers:executing-plans` in the worktree.

Which approach.
