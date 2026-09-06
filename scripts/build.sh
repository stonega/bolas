#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="${BOLAS_BUILD_DIR:-$repo_root/build}"

if [[ -f "$build_dir/build.ninja" ]]; then
  meson setup --reconfigure "$build_dir" "$repo_root"
else
  meson setup "$build_dir" "$repo_root"
fi

meson compile -C "$build_dir"

