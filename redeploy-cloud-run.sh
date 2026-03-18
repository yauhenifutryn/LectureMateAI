#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-lecturemateai-485823}"
REGION="${REGION:-us-central1}"
APP_SERVICE="${APP_SERVICE:-lecturemate-app}"
WORKER_SERVICE="${WORKER_SERVICE:-lecturemate-worker}"

usage() {
  cat <<'USAGE'
Usage:
  bash redeploy-cloud-run.sh app
  bash redeploy-cloud-run.sh worker
  bash redeploy-cloud-run.sh both

This script deploys the code currently checked out in this repo.
If you want the latest GitHub version first, run:

  git fetch origin
  git checkout main
  git reset --hard origin/main

Optional environment overrides:
  PROJECT_ID
  REGION
  APP_SERVICE
  WORKER_SERVICE
USAGE
}

build_and_deploy() {
  local service_name="$1"
  local dockerfile_path="$2"
  local image_name="$3"
  local temp_dockerfile="Dockerfile"
  local image_ref="gcr.io/${PROJECT_ID}/${image_name}:$(date +%Y%m%d-%H%M%S)"

  if [[ ! -f "${dockerfile_path}" ]]; then
    echo "Missing Dockerfile: ${dockerfile_path}" >&2
    exit 1
  fi

  cp "${dockerfile_path}" "${temp_dockerfile}"
  trap 'rm -f "${temp_dockerfile}"' RETURN

  gcloud builds submit \
    --project "${PROJECT_ID}" \
    --tag "${image_ref}" \
    .

  rm -f "${temp_dockerfile}"
  trap - RETURN

  gcloud run deploy "${service_name}" \
    --project "${PROJECT_ID}" \
    --region "${REGION}" \
    --image "${image_ref}" \
    --allow-unauthenticated
}

main() {
  local target="${1:-}"

  if [[ -z "${target}" ]]; then
    usage
    exit 1
  fi

  gcloud config set project "${PROJECT_ID}" >/dev/null

  case "${target}" in
    app)
      build_and_deploy "${APP_SERVICE}" "cloudrun/Dockerfile" "lecturemate-app"
      ;;
    worker)
      build_and_deploy "${WORKER_SERVICE}" "worker/Dockerfile" "lecturemate-worker"
      ;;
    both)
      build_and_deploy "${APP_SERVICE}" "cloudrun/Dockerfile" "lecturemate-app"
      build_and_deploy "${WORKER_SERVICE}" "worker/Dockerfile" "lecturemate-worker"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
