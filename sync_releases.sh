#!/bin/bash
set -euo pipefail

RELEASES_DIR="/var/www/16launcher/releases"
MIRROR_BASE="https://api.16-launcher.ru/releases"
REPO="launcherdev11/rust-launcher"
FORCE_FLAG="${1:-}"

KEEP_RELEASES="${KEEP_RELEASES:-3}"
NGINX_LOG="${NGINX_LOG:-/var/log/nginx/access.log}"
STATS_FILE="${STATS_FILE:-/var/lib/16launcher/downloads.json}"

if ! [[ "$KEEP_RELEASES" =~ ^[0-9]+$ ]] || [ "$KEEP_RELEASES" -lt 1 ]; then
  echo "Ошибка: KEEP_RELEASES должно быть целым числом >= 1 (сейчас: '$KEEP_RELEASES')."
  exit 1
fi

RELEASE_DATA=$(curl -fsS "https://api.github.com/repos/$REPO/releases?per_page=30" | jq -c '
  [ .[]
    | select(.draft == false and .prerelease == false)
    | select(.tag_name | test("^v?[0-9]+(\\.[0-9]+)*$"))
  ] | first // empty')
TAG_NAME=$(echo "$RELEASE_DATA" | jq -r '.tag_name // empty')

if [ -z "$TAG_NAME" ]; then
  echo "Ошибка: не найден стабильный релиз на GitHub (беты, пре-релизы и черновики пропускаются)."
  exit 1
fi

TARGET_DIR="$RELEASES_DIR/$TAG_NAME"
REMOTE_ASSET_COUNT=$(echo "$RELEASE_DATA" | jq '.assets | length')

LOCAL_FILE_COUNT=0
if [ -d "$TARGET_DIR" ]; then
  LOCAL_FILE_COUNT=$(find "$TARGET_DIR" -maxdepth 1 -type f | wc -l)
fi

if [ "$FORCE_FLAG" != "--force" ] && [ -d "$TARGET_DIR" ] && [ "$LOCAL_FILE_COUNT" -ge "$REMOTE_ASSET_COUNT" ]; then
  echo "Версия $TAG_NAME уже актуальна ($LOCAL_FILE_COUNT/$REMOTE_ASSET_COUNT файлов). Пропускаем загрузку."
else
  echo "Обновление $TAG_NAME: скачивание $REMOTE_ASSET_COUNT файлов..."
  mkdir -p "$TARGET_DIR"

  while IFS= read -r URL; do
    FILENAME=$(basename "$URL")
    echo "Скачивание $FILENAME..."
    curl -fsSL "$URL" -o "$TARGET_DIR/$FILENAME"
  done < <(echo "$RELEASE_DATA" | jq -r '.assets[].browser_download_url')
fi

MANIFEST="$TARGET_DIR/latest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Ошибка: $MANIFEST не найден (должен быть в ассетах GitHub Release)."
  exit 1
fi

VERSION_CLEAN=$(jq -r '.version' "$MANIFEST" | sed 's/^[vV]//')
MIRROR_URL="${MIRROR_BASE}/v${VERSION_CLEAN}"

echo "Переписывание URL в latest.json -> ${MIRROR_URL}/"

REWRITTEN=$(jq --arg mirror "$MIRROR_URL" '
  if (.platforms | type) != "object" then
    error("Invalid manifest: expected platforms object")
  else
    .platforms |= with_entries(
      .value |= if (.url? // null) then
        .url = ($mirror + "/" + (.url | split("/") | last))
      else
        .
      end
    )
  end
' "$MANIFEST")

echo "$REWRITTEN" | jq '.' > "$MANIFEST"
echo "$REWRITTEN" | jq '.' > "$RELEASES_DIR/latest.json"
echo "$TAG_NAME" > "$RELEASES_DIR/.current_tag"

echo "Готово: обновлены $RELEASES_DIR/latest.json и $MANIFEST"

count_downloads() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Предупреждение: python3 не найден, подсчёт скачиваний пропущен."
    return 0
  fi

  mkdir -p "$(dirname "$STATS_FILE")"

  RELEASES_DIR="$RELEASES_DIR" NGINX_LOG="$NGINX_LOG" STATS_FILE="$STATS_FILE" python3 -I - <<'PY'
import glob, gzip, json, os, re, sys, tempfile
from datetime import datetime, timezone

releases_dir = os.environ["RELEASES_DIR"]
log_base = os.environ["NGINX_LOG"]
stats_path = os.environ["STATS_FILE"]

LINE = re.compile(
    r'^\S+ \S+ \S+ \[([^\]]+)\] "(\S+) (\S+)[^"]*" (\d{3}) (\d+|-)'
)
PATH = re.compile(r'^/releases/v([0-9][0-9A-Za-z.\-]*)/([A-Za-z0-9._\-]+)$')
INSTALLER = re.compile(r'\.(exe|msi|dmg|deb|rpm|AppImage)$')
UPDATER = re.compile(r'\.(zip|tar\.gz)$')

try:
    with open(stats_path, encoding="utf-8") as f:
        stats = json.load(f)
except (FileNotFoundError, ValueError):
    stats = {}
stats.setdefault("last_ts", 0)
stats.setdefault("total", {"installs": 0, "updates": 0})
stats.setdefault("versions", {})
last_ts = stats["last_ts"]

# Старые логи первыми, актуальный access.log последним.
rotated = sorted(
    (p for p in glob.glob(log_base + ".*") if re.search(r"\.(\d+)(\.gz)?$", p)),
    key=lambda p: int(re.search(r"\.(\d+)(?:\.gz)?$", p).group(1)),
    reverse=True,
)
paths = rotated + ([log_base] if os.path.exists(log_base) else [])
if not paths:
    print(f"Предупреждение: лог {log_base} не найден, подсчёт скачиваний пропущен.")
    sys.exit(0)

size_cache = {}
def file_size(version, name):
    key = (version, name)
    if key not in size_cache:
        p = os.path.join(releases_dir, "v" + version, name)
        size_cache[key] = os.path.getsize(p) if os.path.isfile(p) else None
    return size_cache[key]

max_ts = last_ts
added = {"installs": 0, "updates": 0}

for path in paths:
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.match(line)
            if not m:
                continue
            try:
                ts = int(datetime.strptime(m.group(1), "%d/%b/%Y:%H:%M:%S %z").timestamp())
            except ValueError:
                continue
            if ts <= last_ts:
                continue
            max_ts = max(max_ts, ts)

            method, url, status, sent = m.group(2), m.group(3), m.group(4), m.group(5)
            if method != "GET" or status != "200":
                continue
            pm = PATH.match(url.split("?", 1)[0])
            if not pm:
                continue
            version, name = pm.groups()
            if INSTALLER.search(name):
                kind = "installs"
            elif UPDATER.search(name):
                kind = "updates"
            else:
                continue

            size = file_size(version, name)
            if size and (sent == "-" or int(sent) < size * 0.95):
                continue

            v = stats["versions"].setdefault(version, {"installs": 0, "updates": 0, "files": {}})
            v[kind] += 1
            v["files"][name] = v["files"].get(name, 0) + 1
            stats["total"][kind] += 1
            added[kind] += 1

stats["last_ts"] = max_ts
stats["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

fd, tmp = tempfile.mkstemp(dir=os.path.dirname(stats_path), suffix=".tmp")
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump(stats, f, ensure_ascii=False, indent=2, sort_keys=True)
    f.write("\n")
os.chmod(tmp, 0o644)
os.replace(tmp, stats_path)

print(
    f"Скачивания: +{added['installs']} установок, +{added['updates']} обновлений "
    f"(всего: {stats['total']['installs']} / {stats['total']['updates']})"
)
PY
}

count_downloads || echo "Предупреждение: подсчёт скачиваний завершился с ошибкой (релизы это не затрагивает)."


echo "Очистка старых релизов (хранить: $KEEP_RELEASES)..."

KEPT=0
REMOVED=0
while IFS= read -r NAME; do
  if ! [[ "$NAME" =~ ^v[0-9]+(\.[0-9]+)*(-[A-Za-z0-9.]+)?$ ]]; then
    continue
  fi

  if [ "$NAME" == "$TAG_NAME" ] || [ "$KEPT" -lt "$KEEP_RELEASES" ]; then
    KEPT=$((KEPT + 1))
    continue
  fi

  echo "Удаление старого релиза $NAME..."
  rm -rf -- "${RELEASES_DIR:?}/$NAME"
  REMOVED=$((REMOVED + 1))
done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -Vr)

echo "Очистка завершена: оставлено $KEPT, удалено $REMOVED."
