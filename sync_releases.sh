#!/bin/bash
set -euo pipefail

RELEASES_DIR="/var/www/16launcher/releases"
MIRROR_BASE="https://api.16-launcher.ru/releases"
REPO="Launcherdev11/rust-launcher"
FORCE_FLAG="${1:-}"

RELEASE_DATA=$(curl -fsS "https://api.github.com/repos/$REPO/releases/latest")
TAG_NAME=$(echo "$RELEASE_DATA" | jq -r '.tag_name')

if [ "$TAG_NAME" == "null" ] || [ -z "$TAG_NAME" ]; then
    echo "Ошибка: не удалось получить данные релиза с GitHub."
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
