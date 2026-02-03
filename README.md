# LectureMateAI

## Overview
- LectureMateAI turns lecture audio and slide PDFs into a study guide and transcript using Gemini.
- The UI and API run in a single Cloud Run service.
- A separate Cloud Run worker handles long running Gemini processing.
- Google Cloud Storage stores uploads and results.
- Upstash or Vercel KV stores job state, demo codes, and rate limits.

## Architecture
- App service: Serves the Vite `dist/` build and all `/api/*` routes.
- Worker service: Receives `/worker/run` calls from the app service and executes the job.
- Storage: GCS for files, KV for state.

## Local Development
- Install dependencies: `npm install`.
- Create an environment file. For Vite only, use `.env.local`. For the app server and worker, use `.env` or set `DOTENV_CONFIG_PATH`.
- Build and run the app server: `npm run build`, `npx tsc -p cloudrun/tsconfig.json`, `node build/server/index.js`.
- Build and run the worker in a second terminal: `npx tsc -p worker/tsconfig.json`, `node worker/dist/worker/index.js`.

## Environment Variables
| Name | Required | Used By | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | Yes | App, Worker | Gemini API access. |
| `GCS_BUCKET` | Yes | App, Worker | Bucket for uploads and results. |
| `SYSTEM_INSTRUCTIONS` | Yes in production | App, Worker | Master tutor prompt, see `prompts/system_instructions.txt`. |
| `ADMIN_PASSWORD` | Yes in production | App | Admin access for `/admin`. |
| `KV_REST_API_URL` | Yes | App, Worker | KV endpoint. |
| `KV_REST_API_TOKEN` | Yes | App, Worker | KV token. |
| `KV_REST_API_READ_ONLY_TOKEN` | Recommended | App, Worker | Falls back to `KV_REST_API_TOKEN` if unset. |
| `UPSTASH_REDIS_REST_URL` | Optional | App, Worker | Alternative to `KV_REST_API_URL`. |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | App, Worker | Alternative to `KV_REST_API_TOKEN`. |
| `UPSTASH_REDIS_REST_READ_ONLY_TOKEN` | Optional | App, Worker | Alternative read only token. |
| `WORKER_URL` | Yes | App | Base URL for the worker service. |
| `WORKER_SHARED_SECRET` | Yes | App, Worker | Shared secret for worker auth. |
| `GEMINI_MODEL_ID` | Optional | App, Worker | Overrides default Gemini model. |
| `MAX_UPLOAD_BYTES` | Optional | App, Worker | Defaults to 512 MB. |
| `GCS_UPLOAD_URL_TTL_SECONDS` | Optional | App, Worker | Defaults to 900 seconds. |
| `GCS_RESULT_URL_TTL_SECONDS` | Optional | App, Worker | Defaults to 86400 seconds. |
| `JOB_TTL_SECONDS` | Optional | App, Worker | Defaults to 86400 seconds. |
| `PROCESSING_STALE_MS` | Optional | App | Default is disabled. |
| `WORKER_DISPATCH_TIMEOUT_MS` | Optional | App | Defaults to 5000 ms. |
| `WORKER_POLL_TIMEOUT_MS` | Optional | Worker | Defaults to 15 minutes. |
| `GEMINI_OVERLOAD_MAX_ATTEMPTS` | Optional | Worker | Overload retry tuning. |
| `GEMINI_OVERLOAD_BASE_DELAY_MS` | Optional | Worker | Overload retry tuning. |
| `GEMINI_OVERLOAD_MAX_DELAY_MS` | Optional | Worker | Overload retry tuning. |
| `GEMINI_OVERLOAD_TOTAL_BUDGET_MS` | Optional | Worker | Overload retry tuning. |
| `RATE_LIMIT_WINDOW_SECONDS` | Optional | App | Defaults to 60 seconds. |
| `RATE_LIMIT_DEMO_VALIDATE` | Optional | App | Defaults to 10 per window. |
| `RATE_LIMIT_ADMIN_VERIFY` | Optional | App | Defaults to 5 per window. |
| `RATE_LIMIT_ADMIN` | Optional | App | Defaults to 60 per window. |
| `RATE_LIMIT_PROCESS` | Optional | App | Defaults to 10 per window. |
| `RATE_LIMIT_CHAT` | Optional | App | Defaults to 20 per window. |
| `RATE_LIMIT_UPLOAD` | Optional | App | Defaults to 20 per window. |
| `PORT` | Optional | App, Worker | Defaults to 8080. |

## Cloud Run Deployment
- App service uses `cloudrun/Dockerfile`.
- Worker service uses `worker/Dockerfile`.
- The app service must have `WORKER_URL` pointing at the worker service.
- Both services must share the same `WORKER_SHARED_SECRET`.
- In Cloud Run, service account credentials grant GCS access.
- For local GCS access, use `GOOGLE_APPLICATION_CREDENTIALS` or application default credentials.

## Access Control
- The app is locked by default.
- Enter a demo code on the landing screen, or visit `/admin` with `ADMIN_PASSWORD`.
- KV is required for demo codes, job state, and rate limits.

## Recommended Usage
1. Use good audio sources and prefer MP3 or M4A.
2. Use Chrome or Edge on desktop for system audio capture.
3. Upload slides as PDF.

## License And Commercial Disclaimer
**Copyright 2026 Yauheni Futryn. All Rights Reserved.**

### Demo And Educational Use Only
This source code and application are provided strictly for demonstration, portfolio, and educational purposes.

- No commercial use.
- No redistribution or white labeling without explicit written consent.

### Content Rights And Indemnification
By using this application, you represent and warrant that you own the content you upload or have all necessary rights and licenses to process it. You agree to indemnify and hold harmless Yauheni Futryn from any copyright, IP, or related claims arising from your uploads or use of the generated outputs.
