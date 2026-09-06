#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

"$repo_root/scripts/build.sh"
"$repo_root/scripts/test.sh"

desktop_file="$repo_root/build/data/io.github.stonega.Bolas.desktop"
if command -v desktop-file-validate >/dev/null 2>&1; then
  desktop-file-validate "$desktop_file"
else
  echo "desktop-file-validate is not installed; desktop metadata validation skipped" >&2
fi
