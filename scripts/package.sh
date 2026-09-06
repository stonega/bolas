#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if (( $# > 1 )); then
  echo 'Usage: bash scripts/package.sh [vMAJOR.MINOR.PATCH]' >&2
  exit 1
fi

for tool in meson ninja gjs python3 dpkg-deb rpmbuild tar xz desktop-file-validate; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing package build dependency: $tool" >&2
    exit 1
  fi
done

dist_dir="$repo_root/dist"
mkdir -p "$dist_dir"
work_dir="$(mktemp -d "$dist_dir/.package-XXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT

build_dir="$work_dir/build"
install_root="$work_dir/install-root"
rpm_topdir="$work_dir/rpmbuild"

meson setup "$build_dir" "$repo_root" --prefix=/usr --buildtype=release
version="$(meson introspect "$build_dir" --projectinfo | python3 -c \
  'import json, sys; print(json.load(sys.stdin)["version"])')"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Package builds require a numeric MAJOR.MINOR.PATCH version: $version" >&2
  exit 1
fi
if (( $# == 1 )) && [[ "$1" != "v$version" ]]; then
  echo "Release tag $1 does not match Meson version v$version" >&2
  exit 1
fi
python3 - "$repo_root" "$version" <<'PY'
import json
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
version = sys.argv[2]
package_version = json.loads((root / 'package.json').read_text())['version']
config_version = re.search(r"export const APP_VERSION = '([^']+)';",
                           (root / 'src/config.js').read_text())
if package_version != version or not config_version or config_version[1] != version:
    sys.exit('Keep meson.build, package.json, and src/config.js versions synchronized.')
PY

meson compile -C "$build_dir"
meson test -C "$build_dir" --print-errorlogs
meson install -C "$build_dir" --destdir "$install_root"
desktop-file-validate "$install_root/usr/share/applications/io.github.stonega.Bolas.desktop"

# Package only Meson's installed payload. Generated host caches stay outside it.
deb_root="$work_dir/debian"
mkdir -p "$deb_root"
cp -a "$install_root/." "$deb_root/"
mkdir -p "$deb_root/DEBIAN"
installed_size="$(du -sk "$install_root" | cut -f1)"
sed -e "s/@VERSION@/$version/g" -e "s/@INSTALLED_SIZE@/$installed_size/g" \
  "$repo_root/build-aux/packaging/debian-control.in" > "$deb_root/DEBIAN/control"
install -m 755 "$repo_root/build-aux/packaging/debian-cache-hook" "$deb_root/DEBIAN/postinst"
install -m 755 "$repo_root/build-aux/packaging/debian-cache-hook" "$deb_root/DEBIAN/postrm"
dpkg-deb --root-owner-group -Zxz --build "$deb_root" "$work_dir/bolas_${version}_all.deb"

mkdir -p "$rpm_topdir"/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS,TMP}
tar -C "$install_root" -cJf "$rpm_topdir/SOURCES/bolas-${version}.tar.xz" .
sed "s/@VERSION@/$version/g" \
  "$repo_root/build-aux/packaging/bolas.spec.in" > "$rpm_topdir/SPECS/bolas.spec"
rpmbuild -bb \
  --define "_topdir $rpm_topdir" \
  --define "_tmppath $rpm_topdir/TMP" \
  "$rpm_topdir/SPECS/bolas.spec"

cp "$work_dir/bolas_${version}_all.deb" "$dist_dir/"
cp "$rpm_topdir/RPMS/noarch/bolas-${version}-1.noarch.rpm" "$dist_dir/"
(
  cd "$dist_dir"
  sha256sum "bolas_${version}_all.deb" "bolas-${version}-1.noarch.rpm" > SHA256SUMS
)
printf 'Packages and checksums written to %s\n' "$dist_dir"
