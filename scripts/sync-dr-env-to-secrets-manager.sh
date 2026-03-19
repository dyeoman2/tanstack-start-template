#!/usr/bin/env bash

set -euo pipefail

PROJECT_SLUG="${AWS_DR_PROJECT_SLUG:-tanstack-start-template}"
SECRET_NAME="${AWS_DR_ENV_SECRET_NAME:-${PROJECT_SLUG}/dr-convex-env-vars}"
DEPLOYMENT_FLAG="${1:-"--prod"}"

if [[ "${DEPLOYMENT_FLAG}" == "--preview-name" || "${DEPLOYMENT_FLAG}" == "--deployment-name" ]]; then
  if [[ $# -lt 2 ]]; then
    echo "Usage: $0 [--prod | --preview-name <name> | --deployment-name <name>]" >&2
    exit 1
  fi
  DEPLOYMENT_ARGS=("${DEPLOYMENT_FLAG}" "$2")
elif [[ "${DEPLOYMENT_FLAG}" == "--prod" ]]; then
  DEPLOYMENT_ARGS=("${DEPLOYMENT_FLAG}")
else
  echo "Usage: $0 [--prod | --preview-name <name> | --deployment-name <name>]" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || {
  echo "AWS CLI not found" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || {
  echo "jq not found" >&2
  exit 1
}

command -v pnpm >/dev/null 2>&1 || {
  echo "pnpm not found" >&2
  exit 1
}

aws sts get-caller-identity >/dev/null 2>&1 || {
  echo "AWS credentials are not configured" >&2
  exit 1
}

tmp_json="$(mktemp)"
trap 'rm -f "${tmp_json}"' EXIT

pnpm exec convex env list "${DEPLOYMENT_ARGS[@]}" | jq -Rs '
  split("\n") | map(select(length > 0)) |
  map(capture("^(?<key>[^=]+)=(?<value>.*)$")) | from_entries
' > "${tmp_json}"

if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "file://${tmp_json}" >/dev/null
  echo "Updated Secrets Manager secret: ${SECRET_NAME}"
else
  aws secretsmanager create-secret \
    --name "${SECRET_NAME}" \
    --secret-string "file://${tmp_json}" >/dev/null
  echo "Created Secrets Manager secret: ${SECRET_NAME}"
fi

echo "Synced Convex env vars from: ${DEPLOYMENT_ARGS[*]}"
