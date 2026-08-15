set -euo pipefail

ARCHIVE="${1:-/tmp/launcher-api.tar.gz}"
ROOT="/opt/mc16launcher"
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"

if [[ ! -f "$ARCHIVE" ]]; then
  echo "missing archive: $ARCHIVE" >&2
  exit 1
fi

mkdir -p "$ROOT/backups"
STAMP="$(date +%Y%m%d%H%M)"
BACKUP="$ROOT/backups/pre-deploy-${STAMP}.tar.gz"
echo "==> backup -> $BACKUP"
tar -czf "$BACKUP" -C "$ROOT" \
  --exclude='deploy/.env' \
  backend deploy 2>/dev/null || true

echo "==> extract $ARCHIVE -> $ROOT"
tar -xzf "$ARCHIVE" -C "$ROOT"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy from env.example and fill secrets first" >&2
  exit 1
fi

chmod 600 "$ENV_FILE"

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # portable in-place replace without printing value
    awk -v k="$key" -v v="$value" '
      BEGIN { FS=OFS="=" }
      $1 == k { print k "=" v; next }
      { print }
    ' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

echo "==> harden prod env keys (values not printed)"
upsert_env APP_ENV production
upsert_env IDENTITY_REQUIRE_PROOF true
# API published on loopback; peer IP is docker bridge — keep false unless nginx sets XFF
upsert_env TRUST_PROXY_HEADERS false

# Ensure RESEND is present and non-empty
if ! grep -qE '^RESEND_API_KEY=.+' "$ENV_FILE"; then
  echo "RESEND_API_KEY is empty/missing — APP_ENV=production will refuse to start" >&2
  echo "Set it in $ENV_FILE then re-run: cd $DEPLOY && docker compose up -d api" >&2
  exit 1
fi

# Rotate JWT only if missing/weak for new require_strong_secret rules
JWT_VAL="$(grep -E '^JWT_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
NEED_JWT=0
if [[ ${#JWT_VAL} -lt 32 ]]; then
  NEED_JWT=1
fi
lower="$(printf '%s' "$JWT_VAL" | tr '[:upper:]' '[:lower:]')"
for frag in change-me local-dev replace-with not-for-production openssl-rand placeholder example-secret your-secret; do
  if [[ "$lower" == *"$frag"* ]]; then
    NEED_JWT=1
    break
  fi
done
if [[ "$NEED_JWT" -eq 1 ]]; then
  echo "==> JWT_SECRET weak/missing — generating new one (all sessions will invalidate)"
  NEW_JWT="$(openssl rand -base64 48 | tr -d '\n')"
  upsert_env JWT_SECRET "$NEW_JWT"
else
  echo "==> JWT_SECRET kept (looks strong enough)"
fi

echo "==> docker compose build/up api"
cd "$DEPLOY"
docker compose build api
docker compose up -d api
docker compose ps
echo "==> recent api logs"
docker compose logs api --tail 60
echo "==> health"
sleep 2
curl -sS -o /tmp/mc16-health.out -w "HTTP %{http_code}\n" http://127.0.0.1:8080/health || true
head -c 200 /tmp/mc16-health.out; echo
echo "==> done"
