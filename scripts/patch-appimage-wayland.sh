set -euo pipefail

readonly APPIMAGETOOL_VERSION="1.9.1"
readonly APPIMAGETOOL_SHA256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
readonly APPIMAGETOOL_URL="https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_VERSION}/appimagetool-x86_64.AppImage"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_SRC="$SCRIPT_DIR/appimage/wayland-compat.sh"

fail() {
  echo "patch-appimage-wayland: $*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "patch-appimage-wayland: skip (not Linux)"
  exit 0
fi

command -v find >/dev/null 2>&1 || fail "missing find"
command -v curl >/dev/null 2>&1 || fail "missing curl"
command -v sha256sum >/dev/null 2>&1 || fail "missing sha256sum"
test -f "$HOOK_SRC" || fail "missing hook: $HOOK_SRC"

BUNDLE_DIR="${1:-$REPO_ROOT/src-tauri/target/release/bundle/appimage}"
if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "patch-appimage-wayland: no AppImage bundle dir ($BUNDLE_DIR), skip"
  exit 0
fi

mapfile -t APPIMAGES < <(find "$BUNDLE_DIR" -maxdepth 1 -type f -name '*.AppImage' | sort)
if [[ "${#APPIMAGES[@]}" -eq 0 ]]; then
  echo "patch-appimage-wayland: no *.AppImage in $BUNDLE_DIR, skip"
  exit 0
fi

ensure_appimagetool() {
  local work_dir="$1"
  if [[ -n "${APPIMAGETOOL_PATH:-}" ]]; then
    realpath "$APPIMAGETOOL_PATH"
    return
  fi
  local tool="$work_dir/appimagetool-x86_64.AppImage"
  curl --fail --location --retry 3 --silent --show-error \
    --output "$tool" "$APPIMAGETOOL_URL"
  echo "$APPIMAGETOOL_SHA256  $tool" | sha256sum --check --status \
    || fail "appimagetool checksum verification failed"
  chmod +x "$tool"
  printf '%s\n' "$tool"
}

resign_appimage() {
  local appimage_path="$1"
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
    echo "  skip re-sign (no TAURI_SIGNING_PRIVATE_KEY)"
    rm -f -- "${appimage_path}.sig"
    return
  fi

  (
    cd "$REPO_ROOT"
    npm exec -- tauri signer sign "$appimage_path"
  ) || fail "failed to re-sign $appimage_path"
  echo "  re-signed updater artifact"
}

patch_one() {
  local appimage_path="$1"
  echo "Patching AppImage: $appimage_path"

  local work_dir
  work_dir="$(mktemp -d "$(dirname "$appimage_path")/.wayland-patch.XXXXXX")"
  cleanup() { rm -rf -- "$work_dir"; }
  trap cleanup EXIT

  local extract_dir="$work_dir/extract"
  mkdir -p "$extract_dir"
  (
    cd "$extract_dir"
    "$appimage_path" --appimage-extract >/dev/null
  )
  local app_dir="$extract_dir/squashfs-root"
  test -x "$app_dir/AppRun" || fail "missing AppRun in extracted image"

  mkdir -p "$app_dir/apprun-hooks"
  cp "$HOOK_SRC" "$app_dir/apprun-hooks/wayland-compat.sh"
  chmod +x "$app_dir/apprun-hooks/wayland-compat.sh"

  # linuxdeploy AppRun sources every file in apprun-hooks/; ensure our hook is loaded.
  if [[ -f "$app_dir/AppRun" ]] && ! grep -q 'wayland-compat.sh' "$app_dir/AppRun" 2>/dev/null; then
    # AppRun from linuxdeploy already loops apprun-hooks; nothing else needed.
    true
  fi

  mapfile -d '' bundled < <(
    find "$app_dir/usr/lib" \( -type f -o -type l \) -name 'libwayland-*.so*' -print0 2>/dev/null || true
  )
  if [[ "${#bundled[@]}" -gt 0 ]]; then
    echo "  removing bundled Wayland libraries:"
    for lib in "${bundled[@]}"; do
      echo "    ${lib#"$app_dir"/}"
    done
    rm -f -- "${bundled[@]}"
  else
    echo "  no bundled libwayland-* found (ok)"
  fi

  local runtime_offset
  runtime_offset="$("$appimage_path" --appimage-offset)"
  case "$runtime_offset" in
    ''|*[!0-9]*) fail "invalid AppImage runtime offset: $runtime_offset" ;;
  esac
  local runtime_path="$work_dir/runtime"
  head -c "$runtime_offset" "$appimage_path" >"$runtime_path"

  local appimagetool
  appimagetool="$(ensure_appimagetool "$work_dir")"

  local repacked="$work_dir/repacked.AppImage"
  ARCH="$(uname -m)" APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool" \
    --no-appstream \
    --runtime-file "$runtime_path" \
    "$app_dir" \
    "$repacked"
  test -s "$repacked" || fail "appimagetool produced empty output"
  chmod --reference="$appimage_path" "$repacked" 2>/dev/null || chmod +x "$repacked"

  mv -f -- "$repacked" "$appimage_path"
  resign_appimage "$appimage_path"

  trap - EXIT
  cleanup
  echo "  done"
}

for image in "${APPIMAGES[@]}"; do
  patch_one "$image"
done

echo "patch-appimage-wayland: finished (${#APPIMAGES[@]} file(s))"
