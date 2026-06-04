#!/usr/bin/env node
/**
 * Post-deploy end-to-end smoke test for the LectureMate app.
 *
 * Exercises the EXACT client pipeline against PRODUCTION:
 *   1. POST /api/gcs/upload-url   -> { uploadUrl, objectName }
 *   2. PUT  <signed url>          (raw audio bytes, Content-Type must match)
 *   3. POST /api/process          (create)  -> 202 { jobId }
 *   4. POST /api/process          (action:'run') -> 202/200
 *   5. GET  /api/process?jobId=.. (poll) -> until status completed|failed
 *
 * Mirrors services/geminiService.ts request shapes. Admin auth only:
 *   Authorization: Bearer <ADMIN_PASSWORD>
 *
 * Exit codes:
 *   0  pipeline completed
 *   1  pipeline FAILED (non-2xx, storage_unavailable, job failed, timeout)
 *   2  misconfiguration (missing fixture / gcloud unavailable / no password)
 *
 * Secrets are NEVER printed: the password and full Authorization headers
 * are kept out of all log output.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { execFile } from 'node:child_process';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const BASE_URL = (process.env.LM_BASE_URL || 'https://lecturemate-app-330564771858.us-central1.run.app').replace(/\/+$/, '');
const AUDIO_PATH = resolve(REPO_ROOT, process.env.LM_SMOKE_AUDIO || 'smoke/fixtures/smoke-5min.m4a');
const TOTAL_TIMEOUT_MS = Number(process.env.LM_SMOKE_TIMEOUT_MS || 12 * 60 * 1000);
const POLL_INTERVAL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

const GCLOUD_SERVICE = 'lecturemate-app';
const GCLOUD_REGION = 'us-central1';
const GCLOUD_PROJECT = 'lecturemateai-485823';

const START = Date.now();

// ---------------------------------------------------------------------------
// Logging helpers (secret-safe: never log the password or Authorization value)
// ---------------------------------------------------------------------------

const elapsed = () => `${((Date.now() - START) / 1000).toFixed(1)}s`;
const log = (msg) => console.log(`[${elapsed()}] ${msg}`);
const banner = (step) => console.log(`\n=== ${step} ===`);

const truncate = (s, n = 500) => {
  if (typeof s !== 'string') return '';
  return s.length > n ? `${s.slice(0, n)}... [truncated, ${s.length} chars]` : s;
};

/**
 * Custom error carrying enough context to render a loud failure block.
 */
class SmokeError extends Error {
  constructor(message, { step, httpStatus, body, code, jobId } = {}) {
    super(message);
    this.step = step;
    this.httpStatus = httpStatus;
    this.body = body;
    this.code = code;
    this.jobId = jobId;
  }
}

function failLoudly(err, jobId) {
  console.error('\n############################################################');
  console.error('#                   SMOKE TEST FAILED                      #');
  console.error('############################################################');
  console.error(`  step:        ${err.step || 'unknown'}`);
  if (err.httpStatus !== undefined) console.error(`  httpStatus:  ${err.httpStatus}`);
  if (err.code) console.error(`  errorCode:   ${err.code}`);
  console.error(`  jobId:       ${err.jobId || jobId || '(none)'}`);
  console.error(`  elapsed:     ${elapsed()}`);
  console.error(`  message:     ${err.message}`);
  if (err.body !== undefined && err.body !== null && err.body !== '') {
    console.error(`  responseBody:\n${truncate(typeof err.body === 'string' ? err.body : JSON.stringify(err.body))}`);
  }
  if (err.code === 'storage_unavailable') {
    console.error('  HINT:        storage backend is down. Check Firestore (STORE_BACKEND) and the service config.');
  }
  console.error('############################################################\n');
}

// ---------------------------------------------------------------------------
// Fetch with per-request abort timeout
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, { step } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    const reason = error?.name === 'AbortError'
      ? `request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : (error?.message || 'network error');
    throw new SmokeError(`Network failure: ${reason}`, { step });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a response body once. Returns { json?, text } — json only when parseable.
 */
async function readBody(response) {
  let text = '';
  try {
    text = await response.text();
  } catch {
    return { text: '' };
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json') || (text.trim().startsWith('{'))) {
    try {
      return { json: JSON.parse(text), text };
    } catch {
      // fall through
    }
  }
  return { text };
}

/**
 * Detect storage_unavailable in any error envelope and convert to a hard failure.
 */
function assertNotStorageUnavailable(json, { step, httpStatus, jobId }) {
  const code = json?.error?.code;
  if (code === 'storage_unavailable') {
    throw new SmokeError('Service storage is unavailable (storage_unavailable).', {
      step,
      httpStatus,
      code,
      jobId,
      body: json
    });
  }
}

// ---------------------------------------------------------------------------
// Admin password resolution
// ---------------------------------------------------------------------------

function execFileP(cmd, args) {
  return new Promise((resolveP, rejectP) => {
    execFile(cmd, args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        return rejectP(error);
      }
      resolveP(stdout);
    });
  });
}

/**
 * Returns the admin password. Order:
 *   1. LM_ADMIN_PASSWORD env (if set)
 *   2. gcloud run services describe ... -> parse ADMIN_PASSWORD
 * On failure to obtain it, exits 2 with instructions. NEVER prints the value.
 */
async function resolveAdminPassword() {
  if (process.env.LM_ADMIN_PASSWORD) {
    log('Admin password: using LM_ADMIN_PASSWORD from environment.');
    return process.env.LM_ADMIN_PASSWORD;
  }

  log('Admin password: not in env, fetching from deployed service config via gcloud...');
  let stdout;
  try {
    stdout = await execFileP('gcloud', [
      'run', 'services', 'describe', GCLOUD_SERVICE,
      '--region', GCLOUD_REGION,
      '--project', GCLOUD_PROJECT,
      '--format=value(spec.template.spec.containers[0].env)'
    ]);
  } catch (error) {
    const stderr = (error.stderr || '').toString().trim();
    const notFound = error.code === 'ENOENT';
    console.error('\nCould not obtain ADMIN_PASSWORD.');
    if (notFound) {
      console.error('  gcloud CLI not found on PATH. Install it: https://cloud.google.com/sdk/docs/install');
    } else {
      console.error('  gcloud failed. You may be unauthenticated or lack access to the project.');
      if (stderr) console.error(`  gcloud said: ${truncate(stderr, 300)}`);
      console.error(`  Try: gcloud auth login && gcloud config set project ${GCLOUD_PROJECT}`);
    }
    console.error('  Alternatively, set LM_ADMIN_PASSWORD in the environment and re-run.');
    process.exit(2);
  }

  // gcloud renders env as: [{'name': 'ADMIN_PASSWORD', 'value': '...'}, ...]
  // or "name=ADMIN_PASSWORD;value=...". Parse defensively without echoing.
  const text = stdout.toString();

  // Try structured "name': 'X', 'value': 'Y'" first.
  let match = /['"]?name['"]?\s*[:=]\s*['"]?ADMIN_PASSWORD['"]?\s*[,;]\s*['"]?value['"]?\s*[:=]\s*['"]?([^'"\];,}\n]+)/i.exec(text);
  if (!match) {
    // Try flat "ADMIN_PASSWORD=VALUE" form.
    match = /ADMIN_PASSWORD\s*[:=]\s*['"]?([^'"\];,}\s]+)/i.exec(text);
  }

  if (!match || !match[1]) {
    console.error('\nCould not parse ADMIN_PASSWORD from the service config.');
    console.error('  The env var may be sourced from a Secret rather than an inline value.');
    console.error('  Set LM_ADMIN_PASSWORD in the environment and re-run.');
    process.exit(2);
  }

  log('Admin password: resolved from service config.');
  return match[1];
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

function authHeader(password) {
  // Returned only to attach to fetch; never logged.
  return { Authorization: `Bearer ${password}` };
}

async function requestUploadUrl(password, { filename, mimeType, sizeBytes, uploadBatchId }) {
  const step = 'request-upload-url';
  const response = await fetchWithTimeout(`${BASE_URL}/api/gcs/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(password) },
    body: JSON.stringify({ filename, mimeType, jobId: uploadBatchId, sizeBytes })
  }, { step });

  const { json, text } = await readBody(response);
  assertNotStorageUnavailable(json, { step, httpStatus: response.status });

  if (!response.ok || !json?.uploadUrl || !json?.objectName) {
    throw new SmokeError('Failed to obtain signed upload URL.', {
      step,
      httpStatus: response.status,
      code: json?.error?.code,
      body: json ?? text
    });
  }
  log(`Signed upload URL obtained. objectName=${json.objectName}`);
  return { uploadUrl: json.uploadUrl, objectName: json.objectName };
}

async function putToSignedUrl(uploadUrl, bytes, mimeType) {
  const step = 'put-signed-url';
  // Content-Type MUST match the mimeType sent to upload-url, or the signed
  // PUT signature is rejected. Mirrors uploadToGcs in geminiService.ts.
  const response = await fetchWithTimeout(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: bytes
  }, { step });

  if (!response.ok) {
    const { json, text } = await readBody(response);
    throw new SmokeError('Signed PUT upload to GCS failed.', {
      step,
      httpStatus: response.status,
      body: json ?? text
    });
  }
  log(`Uploaded ${bytes.length} bytes to signed URL (HTTP ${response.status}).`);
}

async function createJob(password, { objectName, mimeType }) {
  const step = 'create-job';
  const response = await fetchWithTimeout(`${BASE_URL}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(password) },
    body: JSON.stringify({
      audio: { objectName, mimeType },
      slides: [],
      userContext: 'Automated post-deploy smoke test.'
    })
  }, { step });

  const { json, text } = await readBody(response);
  assertNotStorageUnavailable(json, { step, httpStatus: response.status });

  // create returns 202 on success.
  if (!response.ok || !json?.jobId) {
    throw new SmokeError('Job creation failed.', {
      step,
      httpStatus: response.status,
      code: json?.error?.code,
      body: json ?? text
    });
  }
  log(`Job created. jobId=${json.jobId} (HTTP ${response.status})`);
  return json.jobId;
}

async function runJob(password, jobId) {
  const step = 'run-job';
  const response = await fetchWithTimeout(`${BASE_URL}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader(password) },
    body: JSON.stringify({ jobId, action: 'run' })
  }, { step });

  const { json, text } = await readBody(response);
  assertNotStorageUnavailable(json, { step, httpStatus: response.status, jobId });

  // run returns 202 (dispatched/processing) or 200 (already terminal). Both ok.
  if (response.status !== 202 && response.status !== 200) {
    throw new SmokeError('Failed to trigger job run.', {
      step,
      httpStatus: response.status,
      code: json?.error?.code,
      jobId,
      body: json ?? text
    });
  }
  log(`Run triggered. status=${json?.status ?? 'unknown'} stage=${json?.stage ?? '-'} (HTTP ${response.status})`);
}

async function getStatus(password, jobId) {
  const step = 'poll-status';
  const response = await fetchWithTimeout(`${BASE_URL}/api/process?jobId=${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: authHeader(password)
  }, { step });

  const { json, text } = await readBody(response);
  assertNotStorageUnavailable(json, { step, httpStatus: response.status, jobId });

  // status returns 200; 404 means the job vanished (store issue) -> hard fail.
  if (!response.ok) {
    throw new SmokeError('Status poll returned an error.', {
      step,
      httpStatus: response.status,
      code: json?.error?.code,
      jobId,
      body: json ?? text
    });
  }
  return json ?? {};
}

/**
 * Strip the query string from a signed URL so the signature is not leaked.
 */
function safeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

async function pollToCompletion(password, jobId) {
  banner('STEP 5: POLL UNTIL TERMINAL');
  const deadline = START + TOTAL_TIMEOUT_MS;
  const stagesSeen = [];
  let lastStage;

  while (Date.now() < deadline) {
    const status = await getStatus(password, jobId);
    const s = status.status ?? 'unknown';
    const stage = status.stage ?? '-';
    const progress = status.progress ?? 0;

    if (stage !== lastStage) {
      stagesSeen.push(stage);
      lastStage = stage;
    }
    log(`poll: status=${s} stage=${stage} progress=${progress}`);

    // A persisted non-transient error on the job is a hard failure even if
    // the HTTP envelope was 200 (status endpoint returns job.error inline).
    if (status.error && s !== 'completed') {
      throw new SmokeError(`Job reported error: ${status.error.message || 'unknown'}`, {
        step: 'poll-status',
        code: status.error.code,
        jobId,
        body: status
      });
    }

    if (s === 'completed') {
      if (!status.resultUrl) {
        throw new SmokeError('Job completed but resultUrl is missing.', {
          step: 'poll-status',
          jobId,
          body: status
        });
      }
      return { status, stagesSeen };
    }

    if (s === 'failed') {
      throw new SmokeError(`Job FAILED: ${status.error?.message || 'no message'}`, {
        step: 'poll-status',
        code: status.error?.code,
        jobId,
        body: status
      });
    }

    // Mirror the client: nudge the run endpoint while queued/processing in
    // early stages, in case the dispatch needs a retry.
    if (s === 'queued' || s === 'processing') {
      if (!stage || ['queued', 'uploading', 'polling', 'generating', 'dispatching'].includes(stage)) {
        try {
          await runJob(password, jobId);
        } catch (error) {
          // Non-fatal nudge; surface but keep polling.
          log(`run nudge failed (non-fatal): ${error.message}`);
        }
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new SmokeError(`Timed out after ${(TOTAL_TIMEOUT_MS / 1000).toFixed(0)}s waiting for completion.`, {
    step: 'poll-status',
    code: 'smoke_timeout',
    jobId,
    body: { stagesSeen }
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let jobId;
  try {
    banner('LectureMate post-deploy smoke test');
    log(`Target: ${BASE_URL}`);
    log(`Fixture: ${AUDIO_PATH}`);
    log(`Total timeout: ${(TOTAL_TIMEOUT_MS / 1000).toFixed(0)}s, poll interval: ${(POLL_INTERVAL_MS / 1000)}s`);

    // -- fixture check (exit 2 if missing) --
    if (!existsSync(AUDIO_PATH)) {
      console.error(`\nFixture not found: ${AUDIO_PATH}`);
      console.error('  The smoke fixture is gitignored and must be created locally.');
      console.error('  Create a ~5 minute clip from any lecture audio:');
      console.error('    ffmpeg -i <any lecture audio> -t 300 -c copy smoke/fixtures/smoke-5min.m4a');
      process.exit(2);
    }

    const password = await resolveAdminPassword();

    const bytes = await readFile(AUDIO_PATH);
    const filename = basename(AUDIO_PATH);
    // m4a -> audio/mp4. Match what the browser/client would send for this type.
    const mimeType = filename.toLowerCase().endsWith('.m4a')
      ? 'audio/mp4'
      : (filename.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream');

    // The client uses a separate per-batch UUID as the upload jobId (object
    // namespace), NOT the processing job id. Mirror that exactly.
    const uploadBatchId = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    banner('STEP 1: REQUEST SIGNED UPLOAD URL');
    const { uploadUrl, objectName } = await requestUploadUrl(password, {
      filename, mimeType, sizeBytes: bytes.length, uploadBatchId
    });

    banner('STEP 2: PUT AUDIO BYTES TO SIGNED URL');
    await putToSignedUrl(uploadUrl, bytes, mimeType);

    banner('STEP 3: CREATE JOB');
    jobId = await createJob(password, { objectName, mimeType });

    banner('STEP 4: TRIGGER RUN');
    await runJob(password, jobId);

    const { status, stagesSeen } = await pollToCompletion(password, jobId);

    banner('SMOKE TEST PASSED');
    log(`Completed in ${elapsed()}.`);
    log(`Stages observed: ${stagesSeen.join(' -> ') || '(none reported)'}`);
    log(`Result (signature stripped): ${safeUrl(status.resultUrl)}`);
    if (status.transcriptUrl) {
      log(`Transcript (signature stripped): ${safeUrl(status.transcriptUrl)}`);
    }
    process.exit(0);
  } catch (error) {
    if (error instanceof SmokeError) {
      failLoudly(error, jobId);
    } else {
      failLoudly(new SmokeError(error?.message || 'Unexpected error.', { step: 'unknown', jobId }), jobId);
    }
    process.exit(1);
  }
}

main();
