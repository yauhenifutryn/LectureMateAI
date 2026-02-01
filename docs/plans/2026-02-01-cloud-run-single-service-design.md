# Cloud Run Single Service Design

## Summary

Deploy a single Google Cloud Run service that serves the LectureMateAI UI and all `/api/*` endpoints. This replaces Vercel as the primary runtime to avoid the 60 second timeout, while keeping Vercel intact as a fallback. The service serves the Vite `dist/` build and routes API requests to the existing handlers without rewriting business logic.

## Goals

- Provide a single public URL that serves both UI and API.
- Remove Vercel runtime timeout constraints for long running Gemini processing.
- Reuse existing API handler logic with minimal changes.
- Keep existing storage integrations, Vercel Blob and Upstash KV.
- Preserve current UI and polling behavior.

## Non Goals

- Replace Vercel Blob or Upstash KV.
- Change the access gate or admin flows.
- Rebuild the UI or change the UX.

## Architecture

### Components

- **Node server**: Serves static files from `dist/` and routes `/api/*` to existing handlers.
- **API handlers**: Existing files in `api/` continue to handle requests with `Request` and `Response`.
- **Static UI**: Vite build output `dist/` is served by the Node server.
- **Storage**: Vercel Blob for files and Upstash KV for job records.

### Request Flow

1. Browser requests `/` or any UI route.
2. Node server serves `dist/index.html` and static assets.
3. UI calls `/api/process` or other API endpoints.
4. Node server adapts Node requests to `Request`, invokes existing handler, returns `Response`.
5. Job polling continues unchanged.

### Adapter Design

- Convert Node `IncomingMessage` to `Request` with full URL, query, method, headers, and body.
- Convert handler `Response` to Node response, preserving headers and status.
- Handle JSON and streaming responses consistently.

## Build and Deploy

- Dockerfile builds UI and server in a single container.
- `npm ci`, `npm run build`, and `npm run build:server` executed during image build.
- Entry point runs the Node server.

## Environment Variables

The Cloud Run service will use the same environment variables as Vercel:

- `GEMINI_API_KEY`
- `SYSTEM_INSTRUCTIONS`
- `BLOB_READ_WRITE_TOKEN`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`
- Any additional existing flags used by the API handlers

## Error Handling and Logging

- Keep handler error shapes unchanged for UI compatibility.
- Node server logs API method, path, status, and duration.
- No request body logging.

## Rollback

- Cloud Run supports revision rollback.
- Vercel remains untouched and can be used as a fallback URL.

## Testing

- Unit tests for the Node adapter.
- Smoke tests for API routing.
- Existing Vitest suite continues to run.
