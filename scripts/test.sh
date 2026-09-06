#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${BOLAS_BUILD_DIR:-$repo_root/build}"

if [[ ! -f "$build_dir/build.ninja" ]]; then
  meson setup "$build_dir" "$repo_root"
fi

meson test -C "$build_dir" --print-errorlogs

