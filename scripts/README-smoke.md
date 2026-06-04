# Post-deploy smoke test

End-to-end check that exercises the real pipeline against PRODUCTION: requests a signed
upload URL, PUTs a small audio fixture to GCS, creates a job, triggers the run, and polls
to completion. Fails loudly (`SMOKE TEST FAILED` block, exit 1) on any non-2xx,
`storage_unavailable`, job `failed`, or timeout. Guards the path that broke twice this week.

## Run

    npm run smoke

Exit codes: `0` passed, `1` pipeline failed, `2` misconfig (missing fixture / no admin password).

## Env vars (all optional)

- `LM_BASE_URL` — target host (default: prod Cloud Run URL).
- `LM_SMOKE_AUDIO` — fixture path relative to repo root (default `smoke/fixtures/smoke-5min.m4a`).
- `LM_ADMIN_PASSWORD` — admin token; if unset, fetched at runtime via `gcloud run services describe`.
- `LM_SMOKE_TIMEOUT_MS` — total budget (default 12 min; polls every 10s).

## Fixture

`smoke/fixtures/smoke-5min.m4a` is gitignored and created locally:

    ffmpeg -i <any lecture audio> -t 300 -c copy smoke/fixtures/smoke-5min.m4a
