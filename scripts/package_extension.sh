#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VER="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT/manifest.json','utf8')).version")"
DATE="$(date +%Y%m%d)"
NAME="1분에디터-${VER}-${DATE}"
STAGE="$(mktemp -d)"
DEST="$ROOT/dist"
python3 "$ROOT/scripts/generate_guides_pdf.py"
mkdir -p "$STAGE/$NAME/extension" "$DEST"
cp "$ROOT/manifest.json" "$STAGE/$NAME/extension/"
cp -R "$ROOT/src" "$ROOT/icons" "$STAGE/$NAME/extension/"
cp "$ROOT/docs/1분에디터_사용방법.pdf" "$STAGE/$NAME/1분에디터_사용방법.pdf"
rm -f "$DEST/$NAME.zip"
python3 - "$STAGE/$NAME" "$DEST/$NAME.zip" <<'PY'
import sys
import zipfile
from pathlib import Path
root = Path(sys.argv[1])
target = Path(sys.argv[2])
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob("*")):
        if path.name == ".DS_Store" or not path.is_file():
            continue
        archive.write(path, path.relative_to(root.parent).as_posix())
PY
rm -rf "$STAGE"
echo "$DEST/$NAME.zip"
