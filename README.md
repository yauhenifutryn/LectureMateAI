# LectureMateAI

## Overview
- LectureMateAI turns lecture audio and slide PDFs into a study guide and transcript.
- Cloud Speech-to-Text V2 with `chirp_3` now handles transcript generation from uploaded audio.
- Gemini still handles study-guide generation from the transcript and slides.
- The UI and API run in a single Cloud Run service.
- A separate Cloud Run worker handles long running Gemini processing.
- Google Cloud Storage stores uploads and results.
- Upstash or Vercel KV stores job state, demo codes, and rate limits.

## Architecture
- App service: Serves the Vite `dist/` build and all `/api/*` routes.
- Worker service: Receives `/worker/run` calls from Cloud Tasks and executes the job.
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
| `CLOUD_TASKS_PROJECT_ID` | Yes in production | App | GCP project that owns the task queue. |
| `CLOUD_TASKS_LOCATION` | Yes in production | App | Cloud Tasks queue region, usually `us-central1`. |
| `CLOUD_TASKS_QUEUE_ID` | Yes in production | App | Queue ID for worker dispatch, for example `lecturemate-worker-queue`. |
| `WORKER_TASK_URL` | Yes in production | App | Private worker URL targeted by Cloud Tasks. |
| `WORKER_TASK_SERVICE_ACCOUNT_EMAIL` | Yes in production | App | Service account email used for Cloud Tasks OIDC calls to the worker. |
| `WORKER_TASK_AUDIENCE` | Optional | App | Explicit OIDC audience override for the worker URL. |
| `WORKER_URL` | Optional local fallback | App | Direct worker base URL when Cloud Tasks is not configured. |
| `WORKER_SHARED_SECRET` | Optional local fallback | App, Worker | Shared secret for local direct worker auth. |
| `GEMINI_MODEL_ID` | Optional | App, Worker | Overrides default Gemini model. |
| `SPEECH_TO_TEXT_PROJECT_ID` | Optional | Worker | Overrides the GCP project used for Speech-to-Text V2. Defaults to Cloud Run project envs. |
| `SPEECH_TO_TEXT_LOCATION` | Optional | Worker | Speech-to-Text V2 region. Defaults to `us`. |
| `TRANSCRIPT_LANGUAGE_CODES` | Optional | Worker | Comma-separated locale list for Chirp 3, or `auto`. Defaults to `auto`. |
| `MAX_UPLOAD_BYTES` | Optional | App, Worker | Defaults to 512 MB. |
| `GCS_UPLOAD_URL_TTL_SECONDS` | Optional | App, Worker | Defaults to 900 seconds. |
| `GCS_RESULT_URL_TTL_SECONDS` | Optional | App, Worker | Defaults to 86400 seconds. |
| `JOB_TTL_SECONDS` | Optional | App, Worker | Defaults to 86400 seconds. |
| `JOB_LEASE_TTL_SECONDS` | Optional | Worker | KV lease TTL for duplicate task suppression, defaults to 1860 seconds. |
| `PROCESSING_STALE_MS` | Optional | App | Default is disabled. |
| `WORKER_DISPATCH_TIMEOUT_MS` | Optional | App | Defaults to 900000 ms (15 minutes). |
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
- Enable the Cloud Tasks API and create a queue in the same region as Cloud Run.
- Enable the Speech-to-Text API for the project.
- The app service must have Cloud Tasks enqueue permissions and `iam.serviceAccountUser` on the worker task invoker service account.
- The worker service should be deployed as private, not `--allow-unauthenticated`.
- Cloud Tasks should invoke the worker with OIDC using `WORKER_TASK_SERVICE_ACCOUNT_EMAIL`.
- `WORKER_URL` and `WORKER_SHARED_SECRET` are now local fallback only.
- In Cloud Run, service account credentials grant GCS access.
- Grant the worker runtime service account `roles/speech.client` so it can call Speech-to-Text V2 recognition endpoints.
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
