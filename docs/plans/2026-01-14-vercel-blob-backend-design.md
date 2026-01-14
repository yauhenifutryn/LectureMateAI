# Vercel Blob Backend Refactor Design

**Goal:** Move all Gemini API calls to backend serverless functions, use Vercel Blob for large file handling, and keep lecture content private through strict cleanup.

## Context
The current Vite React app calls Gemini directly from the browser and injects `GEMINI_API_KEY` via `vite.config.ts`, which exposes the key to clients. Lecture audio files are large, which exceeds Vercel Serverless request body limits. The refactor must preserve audio upload, slide upload, and chat workflows while moving all Gemini interactions to backend endpoints.

## Non Goals
- Introducing a new framework or migrating to Next.js.
- Building a persistent media library, storage must be temporary.
- Complex retry orchestration or queueing.

## Architecture Overview
The frontend will upload files directly to Vercel Blob using a short lived token issued by a new `/api/upload` endpoint. The frontend then calls `/api/process` with Blob URLs and metadata. The backend downloads the Blob files, uploads them to Gemini using the server SDK, generates the study guide and transcript, and then deletes both the Gemini files and the Blob objects. This keeps large files out of serverless request bodies and removes sensitive data after processing.

## Endpoints
- `POST /api/upload`
  - Uses `handleUpload` from `@vercel/blob/client` to authorize client uploads.
  - Token scoping uses pathname prefix, size limit, and content type validation. Tokens are not guaranteed single use, so scoping is enforced by `handleUpload` configuration.

- `POST /api/process`
  - Input: `{ audio: { fileUrl, mimeType }, slides: [{ fileUrl, mimeType }], userContext }`.
  - Validates Blob URL host and pathname prefix to prevent arbitrary URL ingestion.
  - Downloads files server side, uploads to Gemini, and generates output.
  - Cleanup runs in `finally` to delete Gemini files and Blob objects.
  - Output: `{ studyGuide, transcript }` or `{ error: { code, message } }`.

- `POST /api/chat`
  - Input: `{ transcript, studyGuide, messages: [{ role, content }] }`.
  - Generates a follow up response using the chat system prompt.
  - Output: `{ reply }` or `{ error: { code, message } }`.

## Data Flow
1. Frontend requests an upload token from `/api/upload`.
2. Frontend uploads audio and slides directly to Vercel Blob.
3. Frontend sends Blob URLs to `/api/process`.
4. Backend downloads Blob files, uploads to Gemini, and generates content using the existing "Master Tutor" system prompt.
5. Backend deletes Gemini files and Blob objects in `finally`.
6. Backend returns `{ studyGuide, transcript }`.
7. Frontend sends chat messages plus transcript and study guide to `/api/chat` for follow up responses.

## Security and Privacy
- Secrets: `GEMINI_API_KEY` is only in backend environment variables.
- Upload authorization: `handleUpload` scopes allowed content types, size, and pathname.
- URL validation: backend checks `host` and `pathname` prefix for the Blob store, and rejects any other URL.
- Cleanup: backend deletes Gemini files and Blob objects even on errors.

## Cleanup and Retention
- Gemini: delete uploaded files after generation.
- Vercel Blob: delete uploaded objects after generation.
- No retention or caching of lecture files.

## Error Handling
- Backend maps errors to a stable `{ error: { code, message } }` shape.
- Generic error mapping is used unless a stable SDK specific error class is available.
- Frontend renders user friendly messages and encourages retry.

## Frontend Changes
- Remove `@google/genai` usage and direct API key access.
- Upload files using `@vercel/blob/client`.
- Call `/api/process` with Blob URLs and metadata.
- Preserve slides and audio recording behavior.
- Route chat requests through `/api/chat` and remove client side chat session usage.

## Configuration
- New env vars:
  - `GEMINI_API_KEY`
  - `BLOB_READ_WRITE_TOKEN`
- Remove `process.env.GEMINI_API_KEY` injection from `vite.config.ts`.

## Testing
- Add a lightweight unit test harness for Blob URL validation and error mapping.
- Manual verification flow: upload audio and slides, confirm study guide output and cleanup.
