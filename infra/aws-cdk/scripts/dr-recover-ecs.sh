#!/usr/bin/env bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[DR]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[!!]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

generate_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "const { randomBytes } = require('node:crypto'); process.stdout.write(randomBytes(32).toString('hex'))"
    return 0
  fi

  return 1
}

get_output() {
  local key="$1"
  echo "${STACK_OUTPUTS}" | jq -r ".[] | select(.OutputKey==\"${key}\") | .OutputValue"
}

unset CONVEX_DEPLOYMENT 2>/dev/null || true
export CONVEX_DEPLOYMENT=""

PROJECT_SLUG="${DR_PROJECT_SLUG:-tanstack-start-template}"
STACK_NAME="${DR_STACK_NAME:-TanStackStartDrEcsStack}"
BACKEND_SUBDOMAIN="${DR_BACKEND_SUBDOMAIN:-dr-backend}"
SITE_SUBDOMAIN="${DR_SITE_SUBDOMAIN:-dr-site}"
FRONTEND_SUBDOMAIN="${DR_FRONTEND_SUBDOMAIN:-dr}"
DR_ENV_SECRET_NAME="${DR_ENV_SECRET_NAME:-${PROJECT_SLUG}/dr-convex-env-vars}"
CLOUDFLARE_TOKEN_SECRET_NAME="${DR_CLOUDFLARE_TOKEN_SECRET_NAME:-${PROJECT_SLUG}/dr-cloudflare-dns-token}"
CLOUDFLARE_ZONE_SECRET_NAME="${DR_CLOUDFLARE_ZONE_SECRET_NAME:-${PROJECT_SLUG}/dr-cloudflare-zone-id}"
NETLIFY_HOOK_SECRET_NAME="${DR_NETLIFY_HOOK_SECRET_NAME:-${PROJECT_SLUG}/dr-netlify-build-hook}"
TOTAL_STEPS=10

[[ -z "${DR_DOMAIN:-}" ]] && fail "DR_DOMAIN is required"
[[ -z "${DR_BACKUP_S3_BUCKET:-}" ]] && fail "DR_BACKUP_S3_BUCKET is required"

command -v aws >/dev/null || fail "AWS CLI not found"
command -v pnpm >/dev/null || fail "pnpm not found"
command -v jq >/dev/null || fail "jq not found"
command -v curl >/dev/null || fail "curl not found"
command -v docker >/dev/null || warn "Docker not found; recovery will use ECS Exec fallback for admin key generation"

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials are not configured"
ok "AWS credentials verified"

BACKEND_FQDN="${BACKEND_SUBDOMAIN}.${DR_DOMAIN}"
SITE_FQDN="${SITE_SUBDOMAIN}.${DR_DOMAIN}"
FRONTEND_FQDN="${FRONTEND_SUBDOMAIN}.${DR_DOMAIN}"
BACKEND_URL="https://${BACKEND_FQDN}"
SITE_URL="https://${SITE_FQDN}"
FRONTEND_URL="https://${FRONTEND_FQDN}"
CDK_CMD=(pnpm exec cdk deploy "${STACK_NAME}" --require-approval never --app "node ./infra/aws-cdk/bin/app.mjs")

log "Backend FQDN: ${BACKEND_FQDN}"
log "Site FQDN:    ${SITE_FQDN}"
log "Frontend FQDN:${FRONTEND_FQDN}"

if [[ "${SKIP_CDK_DEPLOY:-}" == "true" ]]; then
  warn "Skipping CDK deploy"
else
  log "Step 1/${TOTAL_STEPS}: Deploying ${STACK_NAME}"
  "${CDK_CMD[@]}"
  ok "CDK stack deployed"
fi

log "Step 2/${TOTAL_STEPS}: Reading stack outputs"
STACK_OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs' \
  --output json)

ECS_CLUSTER=$(get_output "EcsClusterName")
ECS_SERVICE=$(get_output "EcsServiceName")
ALB_DNS=$(get_output "AlbDnsName")
INSTANCE_SECRET_ARN=$(get_output "InstanceSecretArn")
STACK_SITE_URL=$(get_output "ConvexSiteUrl")

[[ -z "${ECS_CLUSTER}" ]] && fail "Missing EcsClusterName output"
[[ -z "${ECS_SERVICE}" ]] && fail "Missing EcsServiceName output"
[[ -z "${ALB_DNS}" ]] && fail "Missing AlbDnsName output"
[[ -z "${INSTANCE_SECRET_ARN}" ]] && fail "Missing InstanceSecretArn output"

INSTANCE_SECRET_VALUE=$(aws secretsmanager get-secret-value \
  --secret-id "${INSTANCE_SECRET_ARN}" \
  --query 'SecretString' \
  --output text)

[[ -z "${INSTANCE_SECRET_VALUE}" ]] && fail "Could not fetch instance secret"

ALB_URL="http://${ALB_DNS}"
export CONVEX_SELF_HOSTED_URL="${ALB_URL}"
ok "Using ALB URL ${ALB_URL} for self-hosted Convex CLI operations"

log "Step 3/${TOTAL_STEPS}: Waiting for ECS task health"
for i in $(seq 1 60); do
  task_arns=$(aws ecs list-tasks \
    --cluster "${ECS_CLUSTER}" \
    --service-name "${ECS_SERVICE}" \
    --desired-status RUNNING \
    --query 'taskArns' \
    --output json)

  task_count=$(echo "${task_arns}" | jq 'length')
  if [[ "${task_count}" -gt 0 ]]; then
    TASK_ARN=$(echo "${task_arns}" | jq -r '.[0]')
    break
  fi

  [[ "$i" -eq 60 ]] && fail "No running ECS tasks after 5 minutes"
  sleep 5
done

for i in $(seq 1 30); do
  if curl -sf "${ALB_URL}/version" >/dev/null 2>&1; then
    ok "Backend health check passed"
    break
  fi
  [[ "$i" -eq 30 ]] && fail "Backend did not become healthy via ${ALB_URL}/version"
  sleep 10
done

log "Step 4/${TOTAL_STEPS}: Generating admin key"
admin_key=""

if command -v docker >/dev/null 2>&1; then
  admin_key=$(docker run --rm --entrypoint bash \
    -e INSTANCE_NAME="postgres" \
    -e INSTANCE_SECRET="${INSTANCE_SECRET_VALUE}" \
    ghcr.io/get-convex/convex-backend:latest \
    -c 'cd /convex && ./generate_admin_key.sh 2>&1 | tail -1' 2>/dev/null) || true
fi

if [[ -z "${admin_key}" || "${admin_key}" == "None" ]]; then
  admin_key=$(aws ecs execute-command \
    --cluster "${ECS_CLUSTER}" \
    --task "${TASK_ARN}" \
    --container "convex-backend" \
    --interactive \
    --command "bash -c 'cd /convex && ./generate_admin_key.sh 2>&1 | tail -1'" \
    --output text 2>/dev/null | tail -1) || true
fi

[[ -z "${admin_key}" || "${admin_key}" == "None" ]] && fail "Unable to generate self-hosted Convex admin key"
export CONVEX_SELF_HOSTED_ADMIN_KEY="${admin_key}"
ok "Admin key generated"

log "Step 5/${TOTAL_STEPS}: Deploying Convex functions"
export APP_NAME="${DR_APP_NAME:-TanStack Start Template DR}"
export APP_URL="${APP_URL:-${FRONTEND_URL}}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-${FRONTEND_URL}}"
export CONVEX_SITE_URL="${CONVEX_SITE_URL:-${STACK_SITE_URL:-${SITE_URL}}}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-}"
export JWKS="${JWKS:-}"

if [[ -n "${BETTER_AUTH_SECRET}" ]]; then
  pnpm exec convex env set BETTER_AUTH_SECRET "${BETTER_AUTH_SECRET}" >/dev/null
  ok "BETTER_AUTH_SECRET set"
else
  warn "BETTER_AUTH_SECRET not provided before deploy; ensure it is stored in ${DR_ENV_SECRET_NAME}"
fi

if [[ -n "${JWKS}" ]]; then
  pnpm exec convex env set JWKS "${JWKS}" >/dev/null
  ok "JWKS set"
else
  warn "JWKS not provided before deploy; ensure it is stored in ${DR_ENV_SECRET_NAME}"
fi

pnpm exec convex env set APP_NAME "${APP_NAME}" >/dev/null
pnpm exec convex env set APP_URL "${APP_URL}" >/dev/null
pnpm exec convex env set BETTER_AUTH_URL "${BETTER_AUTH_URL}" >/dev/null
pnpm exec convex env set CONVEX_SITE_URL "${CONVEX_SITE_URL}" >/dev/null
pnpm exec convex deploy
ok "Convex functions deployed"

log "Step 6/${TOTAL_STEPS}: Downloading latest S3 backup"
latest_key=$(aws s3api list-objects-v2 \
  --bucket "${DR_BACKUP_S3_BUCKET}" \
  --prefix "convex-backups/" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' \
  --output text)

[[ -z "${latest_key}" || "${latest_key}" == "None" ]] && fail "No backups found in s3://${DR_BACKUP_S3_BUCKET}/convex-backups/"
backup_file="./dr-backup-$(date -u +%Y%m%dT%H%M%S).zip"
aws s3 cp "s3://${DR_BACKUP_S3_BUCKET}/${latest_key}" "${backup_file}"
ok "Downloaded latest backup ${latest_key}"

log "Step 7/${TOTAL_STEPS}: Importing backup into self-hosted Convex"
pnpm exec convex import --replace-all -y "${backup_file}"
rm -f "${backup_file}"
ok "Backup imported"

log "Step 8/${TOTAL_STEPS}: Applying runtime env vars and DR overrides"
env_json=$(aws secretsmanager get-secret-value \
  --secret-id "${DR_ENV_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || env_json=""

file_storage_backend=$(echo "${env_json}" | jq -r '.FILE_STORAGE_BACKEND // empty' 2>/dev/null || true)
file_serve_secret=$(echo "${env_json}" | jq -r '.AWS_FILE_SERVE_SIGNING_SECRET // .FILE_SERVE_SIGNING_SECRET // empty' 2>/dev/null || true)
if [[ -z "${file_serve_secret}" && "${file_storage_backend}" != "convex" ]]; then
  file_serve_secret=$(generate_hex_secret) || fail "Failed to generate AWS_FILE_SERVE_SIGNING_SECRET"
fi

if [[ -n "${env_json}" && "${env_json}" != "None" ]]; then
  echo "${env_json}" | jq -r 'to_entries[] | "\(.key)\t\(.value)"' | while IFS=$'\t' read -r key value; do
    case "${key}" in
      APP_URL) value="${FRONTEND_URL}" ;;
      BETTER_AUTH_URL) value="${FRONTEND_URL}" ;;
      CONVEX_SITE_URL) value="${STACK_SITE_URL:-${SITE_URL}}" ;;
      VITE_CONVEX_SITE_URL) value="${STACK_SITE_URL:-${SITE_URL}}" ;;
      FILE_STORAGE_BACKEND)
        if [[ -z "${value}" ]]; then
          value="convex"
        fi
        ;;
      AWS_FILE_SERVE_SIGNING_SECRET|FILE_SERVE_SIGNING_SECRET)
        if [[ -n "${file_serve_secret}" ]]; then
          value="${file_serve_secret}"
        fi
        ;;
    esac
    pnpm exec convex env set "${key}" "${value}" >/dev/null
  done
  ok "Runtime env vars applied from ${DR_ENV_SECRET_NAME}"
else
  warn "Secrets Manager secret ${DR_ENV_SECRET_NAME} not found; only DR overrides were applied"
fi

pnpm exec convex env set APP_URL "${FRONTEND_URL}" >/dev/null
pnpm exec convex env set BETTER_AUTH_URL "${FRONTEND_URL}" >/dev/null
pnpm exec convex env set CONVEX_SITE_URL "${STACK_SITE_URL:-${SITE_URL}}" >/dev/null
if [[ -n "${file_storage_backend}" ]]; then
  pnpm exec convex env set FILE_STORAGE_BACKEND "${file_storage_backend}" >/dev/null
fi
if [[ -n "${file_serve_secret}" ]]; then
  pnpm exec convex env set AWS_FILE_SERVE_SIGNING_SECRET "${file_serve_secret}" >/dev/null
fi
ok "DR env overrides enforced"

log "Step 9/${TOTAL_STEPS}: Updating Cloudflare DNS and triggering Netlify DR deploy"
CF_API_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "${CLOUDFLARE_TOKEN_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || CF_API_TOKEN=""
CF_ZONE_ID=$(aws secretsmanager get-secret-value \
  --secret-id "${CLOUDFLARE_ZONE_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || CF_ZONE_ID=""
NETLIFY_HOOK=$(aws secretsmanager get-secret-value \
  --secret-id "${NETLIFY_HOOK_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || NETLIFY_HOOK=""

if [[ -n "${CF_API_TOKEN}" && -n "${CF_ZONE_ID}" ]]; then
  cf_api="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records"
  cf_auth="Authorization: Bearer ${CF_API_TOKEN}"
  for subdomain in "${BACKEND_SUBDOMAIN}" "${SITE_SUBDOMAIN}" "${FRONTEND_SUBDOMAIN}"; do
    fqdn="${subdomain}.${DR_DOMAIN}"
    content="${ALB_DNS}"
    proxied=true
    if [[ "${subdomain}" == "${FRONTEND_SUBDOMAIN}" ]]; then
      content="${DR_FRONTEND_CNAME_TARGET:-}"
      proxied=false
    fi

    if [[ -z "${content}" ]]; then
      warn "Skipping ${fqdn}; DR_FRONTEND_CNAME_TARGET is required for frontend DNS automation"
      continue
    fi

    record_id=$(curl -sf "${cf_api}?name=${fqdn}" -H "${cf_auth}" | jq -r '.result[0].id // empty')
    payload=$(jq -nc \
      --arg type "CNAME" \
      --arg name "${subdomain}" \
      --arg content "${content}" \
      --argjson proxied "${proxied}" \
      '{type:$type,name:$name,content:$content,proxied:$proxied}')

    if [[ -n "${record_id}" ]]; then
      curl -sf -X PUT "${cf_api}/${record_id}" \
        -H "${cf_auth}" \
        -H "Content-Type: application/json" \
        -d "${payload}" >/dev/null
    else
      curl -sf -X POST "${cf_api}" \
        -H "${cf_auth}" \
        -H "Content-Type: application/json" \
        -d "${payload}" >/dev/null
    fi
  done
  ok "Cloudflare DNS records updated"
else
  warn "Cloudflare credentials not available; update DNS records manually"
fi

if [[ -n "${NETLIFY_HOOK}" ]]; then
  curl -sf -X POST "${NETLIFY_HOOK}" >/dev/null
  ok "Netlify DR build hook triggered"
else
  warn "Netlify DR build hook secret ${NETLIFY_HOOK_SECRET_NAME} not found"
fi

log "Step 10/${TOTAL_STEPS}: Final verification"
curl -sf "${ALB_URL}/version" >/dev/null || fail "ALB health check failed"
ok "ALB backend health verified"

if [[ -n "${CF_API_TOKEN}" && -n "${CF_ZONE_ID}" ]]; then
  for endpoint in "${BACKEND_URL}/version" "${SITE_URL}"; do
    if curl -sf "${endpoint}" >/dev/null 2>&1; then
      ok "Verified ${endpoint}"
    else
      warn "Could not verify ${endpoint} yet; DNS or frontend propagation may still be in progress"
    fi
  done
fi

cat <<EOF

Recovery complete.
Backend URL:  ${BACKEND_URL}
Site URL:     ${SITE_URL}
Frontend URL: ${FRONTEND_URL}

Secrets Manager inputs:
  - ${DR_ENV_SECRET_NAME}
  - ${CLOUDFLARE_TOKEN_SECRET_NAME}
  - ${CLOUDFLARE_ZONE_SECRET_NAME}
  - ${NETLIFY_HOOK_SECRET_NAME}
EOF
