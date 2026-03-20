#!/usr/bin/env bash

set -euo pipefail

if [[ -f ".dr.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".dr.env.local"
  set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[DR]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[!!]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

is_likely_convex_admin_auth_token() {
  local value="${1:-}"
  [[ -z "${value}" ]] && return 1
  if [[ "${value}" == prod:* && ${#value} -gt 5 ]]; then
    return 0
  fi
  [[ "${value}" =~ ^[A-Za-z0-9._~-]{24,}$ || "${value}" =~ ^[A-Za-z0-9._~-]+\|[A-Za-z0-9._~-]{24,}$ ]]
}

extract_admin_key_from_output() {
  local output="${1:-}"
  while IFS= read -r line; do
    line="$(printf '%s' "${line}" | tr -d '\r')"
    if is_likely_convex_admin_auth_token "${line}"; then
      printf '%s' "${line}"
      return 0
    fi
  done <<< "${output}"

  return 1
}

docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

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

get_json_value() {
  local key="$1"
  echo "${env_json}" | jq -r --arg key "${key}" '.[$key] // empty' 2>/dev/null || true
}

set_convex_env_if_present() {
  local key="$1"
  local value="$2"
  if [[ -n "${value}" ]]; then
    pnpm exec convex env set "${key}" "${value}" >/dev/null
    ok "${key} set"
  fi
}

persist_dr_env_secret() {
  if [[ -z "${env_json}" || "${env_json}" == "None" ]]; then
    return 0
  fi

  aws secretsmanager put-secret-value \
    --secret-id "${AWS_DR_ENV_SECRET_NAME}" \
    --secret-string "${env_json}" >/dev/null
}

upsert_secret_string() {
  local secret_id="$1"
  local secret_value="$2"
  local description="${3:-}"

  if aws secretsmanager describe-secret --secret-id "${secret_id}" >/dev/null 2>&1; then
    aws secretsmanager put-secret-value \
      --secret-id "${secret_id}" \
      --secret-string "${secret_value}" >/dev/null
  else
    if [[ -n "${description}" ]]; then
      aws secretsmanager create-secret \
        --name "${secret_id}" \
        --description "${description}" \
        --secret-string "${secret_value}" >/dev/null
    else
      aws secretsmanager create-secret \
        --name "${secret_id}" \
        --secret-string "${secret_value}" >/dev/null
    fi
  fi
}

unset CONVEX_DEPLOYMENT 2>/dev/null || true
export CONVEX_DEPLOYMENT=""

PROJECT_SLUG="${AWS_DR_PROJECT_SLUG:-tanstack-start-template}"
STACK_NAME="${AWS_DR_STACK_NAME:-${PROJECT_SLUG}-dr-ecs-stack}"
HOSTNAME_STRATEGY="${AWS_DR_HOSTNAME_STRATEGY:-custom-domain}"
BACKEND_SUBDOMAIN="${AWS_DR_BACKEND_SUBDOMAIN:-dr-backend}"
SITE_SUBDOMAIN="${AWS_DR_SITE_SUBDOMAIN:-dr-site}"
FRONTEND_SUBDOMAIN="${AWS_DR_FRONTEND_SUBDOMAIN:-dr}"
AWS_DR_ENV_SECRET_NAME="${AWS_DR_ENV_SECRET_NAME:-${PROJECT_SLUG}-dr-convex-env-secret}"
AWS_DR_CONVEX_ADMIN_KEY_SECRET_NAME="${AWS_DR_CONVEX_ADMIN_KEY_SECRET_NAME:-${PROJECT_SLUG}-dr-convex-admin-key-secret}"
AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME="${AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME:-${PROJECT_SLUG}-dr-cloudflare-dns-token-secret}"
AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME="${AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME:-${PROJECT_SLUG}-dr-cloudflare-zone-id-secret}"
AWS_DR_NETLIFY_HOOK_SECRET_NAME="${AWS_DR_NETLIFY_HOOK_SECRET_NAME:-${PROJECT_SLUG}-dr-netlify-build-hook-secret}"
AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME="${AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME:-${PROJECT_SLUG}-dr-netlify-frontend-cname-target-secret}"
TOTAL_STEPS=10

if [[ "${HOSTNAME_STRATEGY}" != "custom-domain" && "${HOSTNAME_STRATEGY}" != "provider-hostnames" ]]; then
  fail "AWS_DR_HOSTNAME_STRATEGY must be custom-domain or provider-hostnames"
fi
if [[ "${HOSTNAME_STRATEGY}" == "custom-domain" && -z "${AWS_DR_DOMAIN:-}" ]]; then
  fail "AWS_DR_DOMAIN is required for custom-domain recovery"
fi
[[ -z "${AWS_DR_BACKUP_S3_BUCKET:-}" ]] && fail "AWS_DR_BACKUP_S3_BUCKET is required"

command -v aws >/dev/null || fail "AWS CLI not found"
command -v pnpm >/dev/null || fail "pnpm not found"
command -v jq >/dev/null || fail "jq not found"
command -v curl >/dev/null || fail "curl not found"
command -v docker >/dev/null || warn "Docker not found; recovery will use ECS Exec fallback for admin key generation"
if command -v docker >/dev/null 2>&1 && ! docker_ready; then
  warn "Docker is installed but the Docker daemon is not reachable; recovery will use ECS Exec fallback for admin key generation"
fi
command -v session-manager-plugin >/dev/null 2>&1 || warn "session-manager-plugin not found; ECS Exec fallback may fail for admin key generation"

if ! docker_ready && ! command -v session-manager-plugin >/dev/null 2>&1; then
  fail "Neither a reachable Docker daemon nor session-manager-plugin is available. Start Docker Desktop or install session-manager-plugin before running DR recovery."
fi

aws sts get-caller-identity >/dev/null 2>&1 || fail "AWS credentials are not configured"
ok "AWS credentials verified"

CDK_CMD=(pnpm exec cdk deploy "${STACK_NAME}" --require-approval never --app "node ./infra/aws-cdk/bin/app.mjs")

BACKEND_FQDN=""
SITE_FQDN=""
FRONTEND_FQDN=""
BACKEND_URL=""
SITE_URL=""
FRONTEND_URL=""

if [[ "${HOSTNAME_STRATEGY}" == "custom-domain" ]]; then
  BACKEND_FQDN="${BACKEND_SUBDOMAIN}.${AWS_DR_DOMAIN}"
  SITE_FQDN="${SITE_SUBDOMAIN}.${AWS_DR_DOMAIN}"
  FRONTEND_FQDN="${FRONTEND_SUBDOMAIN}.${AWS_DR_DOMAIN}"
  BACKEND_URL="https://${BACKEND_FQDN}"
  SITE_URL="https://${SITE_FQDN}"
  FRONTEND_URL="https://${FRONTEND_FQDN}"
  log "Backend FQDN: ${BACKEND_FQDN}"
  log "Site FQDN:    ${SITE_FQDN}"
  log "Frontend FQDN:${FRONTEND_FQDN}"
else
  log "Using provider-hostnames recovery mode"
fi

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
STACK_BACKEND_URL=$(get_output "ConvexBackendUrl")
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

if [[ -n "${STACK_BACKEND_URL}" && "${STACK_BACKEND_URL}" != "None" ]]; then
  BACKEND_URL="${STACK_BACKEND_URL}"
fi
if [[ -n "${STACK_SITE_URL}" && "${STACK_SITE_URL}" != "None" ]]; then
  SITE_URL="${STACK_SITE_URL}"
fi

NETLIFY_FRONTEND_CNAME_TARGET_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || NETLIFY_FRONTEND_CNAME_TARGET_SECRET=""

if [[ "${HOSTNAME_STRATEGY}" == "provider-hostnames" ]]; then
  frontend_host="${AWS_DR_FRONTEND_CNAME_TARGET:-${NETLIFY_FRONTEND_CNAME_TARGET_SECRET:-}}"
  if [[ -n "${frontend_host}" ]]; then
    FRONTEND_URL="https://${frontend_host}"
  fi
fi

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
docker_admin_key_error=""
ecs_exec_admin_key_error=""

if docker_ready; then
  docker_admin_key_output=$(docker run --rm --entrypoint bash \
    -e INSTANCE_NAME="postgres" \
    -e INSTANCE_SECRET="${INSTANCE_SECRET_VALUE}" \
    ghcr.io/get-convex/convex-backend:latest \
    -c 'cd /convex && ./generate_admin_key.sh 2>&1 | tail -1' 2>&1) || docker_admin_key_error="${docker_admin_key_output:-docker command failed}"
  admin_key="$(extract_admin_key_from_output "${docker_admin_key_output:-}" || true)"
  if ! is_likely_convex_admin_auth_token "${admin_key}"; then
    [[ -n "${docker_admin_key_output:-}" ]] && docker_admin_key_error="${docker_admin_key_output}"
    admin_key=""
  fi
fi

if [[ -z "${admin_key}" || "${admin_key}" == "None" ]]; then
  if ! command -v session-manager-plugin >/dev/null 2>&1; then
    ecs_exec_admin_key_error="session-manager-plugin is not installed"
  else
    ecs_exec_admin_key_output=$(aws ecs execute-command \
      --cluster "${ECS_CLUSTER}" \
      --task "${TASK_ARN}" \
      --container "convex-backend" \
      --interactive \
      --command "bash -c 'cd /convex && ./generate_admin_key.sh 2>&1 | tail -1'" \
      --output text 2>&1) || ecs_exec_admin_key_error="${ecs_exec_admin_key_output:-aws ecs execute-command failed}"
    admin_key="$(extract_admin_key_from_output "${ecs_exec_admin_key_output:-}" || true)"
    if ! is_likely_convex_admin_auth_token "${admin_key}"; then
      [[ -n "${ecs_exec_admin_key_output:-}" ]] && ecs_exec_admin_key_error="${ecs_exec_admin_key_output}"
      admin_key=""
    fi
  fi
fi

if [[ -z "${admin_key}" || "${admin_key}" == "None" ]]; then
  [[ -n "${docker_admin_key_error}" ]] && warn "Docker admin-key generation failed: ${docker_admin_key_error}"
  [[ -n "${ecs_exec_admin_key_error}" ]] && warn "ECS Exec admin-key generation failed: ${ecs_exec_admin_key_error}"
  fail "Unable to generate self-hosted Convex admin key"
fi
export CONVEX_SELF_HOSTED_ADMIN_KEY="${admin_key}"
upsert_secret_string \
  "${AWS_DR_CONVEX_ADMIN_KEY_SECRET_NAME}" \
  "${admin_key}" \
  "Self-hosted Convex admin key for the DR ECS instance"
ok "Admin key generated"

log "Step 5/${TOTAL_STEPS}: Applying minimum pre-deploy env and deploying Convex functions"
env_json=$(aws secretsmanager get-secret-value \
  --secret-id "${AWS_DR_ENV_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || env_json=""

predeploy_app_name="$(get_json_value 'APP_NAME')"
predeploy_better_auth_secret="$(get_json_value 'BETTER_AUTH_SECRET')"
predeploy_jwks="$(get_json_value 'JWKS')"

set_convex_env_if_present "APP_NAME" "${predeploy_app_name:-${APP_NAME:-TanStack Start Template DR}}"
set_convex_env_if_present "BETTER_AUTH_URL" "${FRONTEND_URL}"
if [[ -n "${predeploy_better_auth_secret}" ]]; then
  set_convex_env_if_present "BETTER_AUTH_SECRET" "${predeploy_better_auth_secret}"
else
  warn "BETTER_AUTH_SECRET not found in ${AWS_DR_ENV_SECRET_NAME}"
fi

if [[ -n "${predeploy_jwks}" ]]; then
  set_convex_env_if_present "JWKS" "${predeploy_jwks}"
else
  warn "JWKS not found in ${AWS_DR_ENV_SECRET_NAME}"
fi

if [[ -z "${env_json}" || "${env_json}" == "None" ]]; then
  fail "Secrets Manager secret ${AWS_DR_ENV_SECRET_NAME} not found before deploy. Run pnpm run dr:sync-env first."
fi

pnpm exec convex deploy
ok "Convex functions deployed"

log "Step 6/${TOTAL_STEPS}: Downloading latest S3 backup"
latest_key=$(aws s3api list-objects-v2 \
  --bucket "${AWS_DR_BACKUP_S3_BUCKET}" \
  --prefix "convex-backups/" \
  --query 'sort_by(Contents, &LastModified)[-1].Key' \
  --output text)

[[ -z "${latest_key}" || "${latest_key}" == "None" ]] && fail "No backups found in s3://${AWS_DR_BACKUP_S3_BUCKET}/convex-backups/"
backup_file="./dr-backup-$(date -u +%Y%m%dT%H%M%S).zip"
aws s3 cp "s3://${AWS_DR_BACKUP_S3_BUCKET}/${latest_key}" "${backup_file}"
ok "Downloaded latest backup ${latest_key}"

log "Step 7/${TOTAL_STEPS}: Importing backup into self-hosted Convex"
pnpm exec convex import --replace-all -y "${backup_file}"
rm -f "${backup_file}"
ok "Backup imported"

log "Step 8/${TOTAL_STEPS}: Applying runtime env vars and DR overrides"
file_storage_backend=$(echo "${env_json}" | jq -r '.FILE_STORAGE_BACKEND // empty' 2>/dev/null || true)
file_serve_secret=$(echo "${env_json}" | jq -r '.AWS_FILE_SERVE_SIGNING_SECRET // .FILE_SERVE_SIGNING_SECRET // empty' 2>/dev/null || true)
should_persist_file_serve_secret="false"
if [[ -z "${file_serve_secret}" && "${file_storage_backend}" != "convex" ]]; then
  file_serve_secret=$(generate_hex_secret) || fail "Failed to generate AWS_FILE_SERVE_SIGNING_SECRET"
  should_persist_file_serve_secret="true"
fi

if [[ -n "${env_json}" && "${env_json}" != "None" ]]; then
  echo "${env_json}" | jq -r 'to_entries[] | "\(.key)\t\(.value)"' | while IFS=$'\t' read -r key value; do
    case "${key}" in
      BETTER_AUTH_URL) value="${FRONTEND_URL}" ;;
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
  ok "Runtime env vars applied from ${AWS_DR_ENV_SECRET_NAME}"
else
  fail "Secrets Manager secret ${AWS_DR_ENV_SECRET_NAME} not found during runtime env apply. Run pnpm run dr:sync-env first."
fi

if [[ -n "${FRONTEND_URL}" ]]; then
  pnpm exec convex env set BETTER_AUTH_URL "${FRONTEND_URL}" >/dev/null
fi
if [[ -n "${file_storage_backend}" ]]; then
  pnpm exec convex env set FILE_STORAGE_BACKEND "${file_storage_backend}" >/dev/null
fi
if [[ -n "${file_serve_secret}" ]]; then
  pnpm exec convex env set AWS_FILE_SERVE_SIGNING_SECRET "${file_serve_secret}" >/dev/null
fi

if [[ "${should_persist_file_serve_secret}" == "true" && -n "${env_json}" && "${env_json}" != "None" ]]; then
  env_json=$(echo "${env_json}" | jq --arg value "${file_serve_secret}" '. + {AWS_FILE_SERVE_SIGNING_SECRET: $value}')
  persist_dr_env_secret
  ok "Persisted AWS_FILE_SERVE_SIGNING_SECRET to ${AWS_DR_ENV_SECRET_NAME}"
fi

ok "DR env overrides enforced"

log "Step 9/${TOTAL_STEPS}: Updating Cloudflare DNS and triggering Netlify DR deploy"
CF_API_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "${AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || CF_API_TOKEN=""
CF_ZONE_ID=$(aws secretsmanager get-secret-value \
  --secret-id "${AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || CF_ZONE_ID=""
NETLIFY_HOOK=$(aws secretsmanager get-secret-value \
  --secret-id "${AWS_DR_NETLIFY_HOOK_SECRET_NAME}" \
  --query 'SecretString' \
  --output text 2>/dev/null) || NETLIFY_HOOK=""

if [[ "${HOSTNAME_STRATEGY}" == "custom-domain" && -n "${CF_API_TOKEN}" && -n "${CF_ZONE_ID}" ]]; then
  cf_api="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records"
  cf_auth="Authorization: Bearer ${CF_API_TOKEN}"
  for subdomain in "${BACKEND_SUBDOMAIN}" "${SITE_SUBDOMAIN}" "${FRONTEND_SUBDOMAIN}"; do
    fqdn="${subdomain}.${AWS_DR_DOMAIN}"
    content="${ALB_DNS}"
    proxied=true
    if [[ "${subdomain}" == "${FRONTEND_SUBDOMAIN}" ]]; then
      content="${AWS_DR_FRONTEND_CNAME_TARGET:-${NETLIFY_FRONTEND_CNAME_TARGET_SECRET:-}}"
      proxied=false
    fi

    if [[ -z "${content}" ]]; then
      warn "Skipping ${fqdn}; AWS_DR_FRONTEND_CNAME_TARGET or ${AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME} is required for frontend DNS automation"
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
elif [[ "${HOSTNAME_STRATEGY}" == "provider-hostnames" ]]; then
  ok "Skipping Cloudflare DNS updates in provider-hostnames mode"
else
  warn "Cloudflare credentials not available; update DNS records manually"
fi

if [[ -n "${NETLIFY_HOOK}" ]]; then
  curl -sf -X POST "${NETLIFY_HOOK}" >/dev/null
  ok "Netlify DR build hook triggered"
else
  warn "Netlify DR build hook secret ${AWS_DR_NETLIFY_HOOK_SECRET_NAME} not found"
fi

log "Step 10/${TOTAL_STEPS}: Final verification"
curl -sf "${ALB_URL}/version" >/dev/null || fail "ALB health check failed"
ok "ALB backend health verified"

if [[ "${HOSTNAME_STRATEGY}" == "custom-domain" && -n "${CF_API_TOKEN}" && -n "${CF_ZONE_ID}" ]]; then
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
  - ${AWS_DR_ENV_SECRET_NAME}
  - ${AWS_DR_CONVEX_ADMIN_KEY_SECRET_NAME}
  - ${AWS_DR_CLOUDFLARE_TOKEN_SECRET_NAME}
  - ${AWS_DR_CLOUDFLARE_ZONE_SECRET_NAME}
  - ${AWS_DR_NETLIFY_HOOK_SECRET_NAME}
  - ${AWS_DR_NETLIFY_FRONTEND_CNAME_TARGET_SECRET_NAME}
EOF
