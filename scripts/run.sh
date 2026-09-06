#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
schema_dir="${BOLAS_SCHEMA_DIR:-$repo_root/build/data}"

mkdir -p "$schema_dir"
glib-compile-schemas --strict --targetdir "$schema_dir" "$repo_root/data"
export GSETTINGS_SCHEMA_DIR="$schema_dir"

exec gjs -m "$repo_root/src/main.js" "$@"
