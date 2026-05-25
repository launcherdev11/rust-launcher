set -euo pipefail

TAG="${RELEASE_TAG:-}"
if [[ -z "$TAG" ]]; then
  echo "RELEASE_TAG is required" >&2
  exit 1
fi

if [[ -n "${RELEASE_NOTES_ROOT:-}" ]]; then
  ROOT="$RELEASE_NOTES_ROOT"
elif [[ -d release-notes/releases ]]; then
  ROOT="release-notes/releases"
else
  ROOT="releases"
fi

FILE="${ROOT}/${TAG}.md"
if [[ ! -f "$FILE" ]]; then
  echo "Release notes not found: ${FILE}" >&2
  echo "Create ${TAG}.md in your release-notes repo (see .github/RELEASE_NOTES.md)." >&2
  exit 1
fi

TITLE="$(head -n1 "$FILE" | sed -e 's/^# *//' -e 's/\r$//')"
if [[ -z "$TITLE" ]]; then
  echo "First line of ${FILE} must be '# Release title'" >&2
  exit 1
fi

BODY="$(tail -n +2 "$FILE" | sed -e 's/\r$//')"

{
  echo "title<<EOF"
  echo "$TITLE"
  echo "EOF"
  echo "body<<EOF"
  echo "$BODY"
  echo "EOF"
} >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
