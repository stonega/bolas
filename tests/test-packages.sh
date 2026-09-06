#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["version"])' \
  "$repo_root/package.json")"
deb="$repo_root/dist/bolas_${version}_all.deb"
rpm="$repo_root/dist/bolas-${version}-1.noarch.rpm"
work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

(cd "$repo_root/dist" && sha256sum --check SHA256SUMS)
[[ "$(dpkg-deb --field "$deb" Package)" == bolas ]]
[[ "$(dpkg-deb --field "$deb" Version)" == "$version" ]]
[[ "$(dpkg-deb --field "$deb" Architecture)" == all ]]
[[ "$(dpkg-deb --field "$deb" Installed-Size)" -gt 0 ]]
[[ "$(rpm -qp --queryformat '%{NAME} %{VERSION} %{ARCH}' "$rpm")" == "bolas $version noarch" ]]
dpkg-deb --extract "$deb" "$work_dir/deb"
dpkg-deb --control "$deb" "$work_dir/control"
mkdir -p "$work_dir/rpm"
(cd "$work_dir/rpm" && rpm2cpio "$rpm" | cpio --extract --make-directories --quiet)

python3 - "$work_dir" "$rpm" <<'PY'
import pathlib
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
deb = root / 'deb'
rpm = root / 'rpm'
deb_files = {p.relative_to(deb) for p in deb.rglob('*') if p.is_file()}
rpm_files = {p.relative_to(rpm) for p in rpm.rglob('*') if p.is_file()}
assert deb_files == rpm_files, f'Package contents differ: {deb_files ^ rpm_files}'
for path in deb_files:
    assert (deb / path).read_bytes() == (rpm / path).read_bytes(), f'Payload differs: {path}'

required = [
    'usr/bin/bolas',
    'usr/share/bolas/main.js',
    'usr/share/bolas/editor/window.js',
    'usr/share/bolas/video/window.js',
    'usr/share/bolas/services/video-export.js',
    'usr/share/bolas/share/backgrounds/aurora-mesh.png',
    'usr/share/bolas/share/backgrounds/swatches/aurora-mesh.png',
    'usr/share/bolas/icons/tool-select-symbolic.svg',
    'usr/share/applications/io.github.stonega.Bolas.desktop',
    'usr/share/dbus-1/services/io.github.stonega.Bolas.service',
    'usr/share/glib-2.0/schemas/io.github.stonega.Bolas.gschema.xml',
    'usr/share/mime/packages/io.github.stonega.Bolas-workspace.xml',
    'usr/share/icons/hicolor/scalable/apps/io.github.stonega.Bolas.svg',
]
for path in required:
    assert (deb / path).is_file(), f'Missing installed file: {path}'
assert 'file:///usr/share/bolas/main.js' in (deb / 'usr/bin/bolas').read_text()
assert 'Exec=/usr/bin/bolas' in (
    deb / 'usr/share/dbus-1/services/io.github.stonega.Bolas.service').read_text()
assert (deb / 'usr/bin/bolas').stat().st_mode & 0o111 == 0o111
for hook in ['postinst', 'postrm']:
    assert (root / 'control' / hook).stat().st_mode & 0o111 == 0o111
for path in deb_files:
    assert path.parts[:2] in [('usr', 'bin'), ('usr', 'share')], f'Unexpected path: {path}'
    assert path.name not in ['gschemas.compiled', 'mime.cache', 'icon-theme.cache']

owners = subprocess.check_output([
    'rpm', '-qp', '--queryformat', '[%{FILEUSERNAME}:%{FILEGROUPNAME}\n]', sys.argv[2]
], text=True).splitlines()
assert owners and set(owners) == {'root:root'}, 'RPM payload must belong to root'
print(f'Both packages contain the same {len(deb_files)} installed files.')
PY

glib-compile-schemas --strict --dry-run "$work_dir/deb/usr/share/glib-2.0/schemas"
desktop-file-validate "$work_dir/deb/usr/share/applications/io.github.stonega.Bolas.desktop"
printf 'Package metadata, payloads, launcher, and desktop integration passed.\n'
