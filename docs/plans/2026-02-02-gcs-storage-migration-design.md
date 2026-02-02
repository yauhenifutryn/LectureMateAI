# GCS Storage Migration Design (Signed Uploads)

## Goal
Move all file storage from Vercel Blob to Google Cloud Storage (GCS) while preserving existing app UX, admin features, and async processing flow. Large audio and slide uploads must continue to work via direct-to-storage uploads, with automatic cleanup of input files after processing and admin purge support.

## Architecture Overview
- Replace Blob usage with GCS using signed URLs for direct client uploads.
- Store input files under `uploads/<jobId>/...` and results under `results/<jobId>/study-guide.md`.
- Keep KV (Upstash) for job state, demo codes, and admin logs.
- Keep the worker model. The app service dispatches jobs to worker. The worker downloads inputs from GCS, calls Gemini, writes results to GCS, and deletes input objects.

## Data Flow
1. Frontend requests `POST /api/gcs/upload-url` with file metadata and auth.
2. Backend validates auth and returns `{ uploadUrl, objectName, publicUrl? }`.
3. Frontend uploads to GCS via `PUT uploadUrl` and then calls `POST /api/process` with `{ objectName, mimeType, ... }`.
4. Worker downloads inputs via GCS SDK, sends to Gemini, stores result in GCS, deletes input objects, and updates KV state.
5. Frontend polls `/api/process?jobId=...` for status and reads result URL from KV.

## Security
- Signed URLs are short-lived and scoped to a single object key.
- Server validates `objectName` to prevent path traversal and cross-bucket access.
- Admin purge operates on GCS `uploads/` and `results/` prefixes only.

## Cleanup Strategy
- Worker deletes input objects in `uploads/` after successful generation.
- Admin purge deletes all objects under both `uploads/` and `results/` or only `uploads/` depending on admin selection (default all).
- If a job fails before cleanup, admin purge remains the safety valve.

## Configuration
New env vars (app + worker):
- `GCS_BUCKET`
- `GCS_UPLOAD_URL_TTL_SECONDS` (default 900)
- `GCS_RESULT_URL_TTL_SECONDS` (default 86400)

Existing env vars remain:
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`
- `WORKER_URL`, `WORKER_SHARED_SECRET`
- `GEMINI_API_KEY`, `SYSTEM_INSTRUCTIONS`
- `ADMIN_PASSWORD`

## Non-Goals
- Replacing KV with another datastore.
- Introducing resumable uploads or multipart logic.
- Changing UI layout beyond upload wiring and status details.
