# Cloud Run Redeploy

This repository deploys two Google Cloud Run services from the repository root:

- `lecturemate-app`
- `lecturemate-worker`

Project-specific defaults:

- Project: `lecturemateai-485823`
- Region: `us-central1`
- App Dockerfile: `cloudrun/Dockerfile`
- Worker Dockerfile: `worker/Dockerfile`

## Recommended Sync First

If you want the latest code from GitHub before redeploying:

```bash
gcloud config set project lecturemateai-485823

cd ~/LectureMateAI
git fetch origin
git checkout main
git reset --hard origin/main
```

## One-Command Deploy

Run the helper script from repo root:

```bash
cd ~/LectureMateAI
bash redeploy-cloud-run.sh app
bash redeploy-cloud-run.sh worker
bash redeploy-cloud-run.sh both
```

The script deploys whatever code is currently checked out in the repo.

## Manual App Redeploy

```bash
gcloud config set project lecturemateai-485823

cd ~/LectureMateAI
git fetch origin
git checkout main
git reset --hard origin/main

cp cloudrun/Dockerfile Dockerfile
APP_IMG="gcr.io/lecturemateai-485823/lecturemate-app:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --project lecturemateai-485823 --tag "$APP_IMG" .
rm Dockerfile

gcloud run deploy lecturemate-app \
  --project lecturemateai-485823 \
  --region us-central1 \
  --image "$APP_IMG" \
  --allow-unauthenticated
```

## Manual Worker Redeploy

```bash
gcloud config set project lecturemateai-485823

cd ~/LectureMateAI
git fetch origin
git checkout main
git reset --hard origin/main

cp worker/Dockerfile Dockerfile
WORKER_IMG="gcr.io/lecturemateai-485823/lecturemate-worker:$(date +%Y%m%d-%H%M%S)"
gcloud builds submit --project lecturemateai-485823 --tag "$WORKER_IMG" .
rm Dockerfile

gcloud run deploy lecturemate-worker \
  --project lecturemateai-485823 \
  --region us-central1 \
  --image "$WORKER_IMG" \
  --allow-unauthenticated
```

## Why The Script And Manual Commands Look Slightly Different

- The script is reusable, so project, region, and service names are defaults that can be overridden with environment variables.
- The manual commands are fully expanded for clarity.
- Both approaches target the same services and Dockerfiles.

## Environment Variables

The script does not need to fetch service env vars.

Cloud Run service environment variables remain attached to the service unless you explicitly replace or clear them with deploy flags such as:

- `--set-env-vars`
- `--clear-env-vars`
- `--remove-env-vars`

This redeploy flow only updates the image. It does not wipe existing service env vars.

## Safe To Commit

These files are safe to push because they contain:

- project id
- region
- service names
- repo-relative Dockerfile paths

They do not contain secrets, tokens, passwords, or private keys.
