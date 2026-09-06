# Native packaging

`.github/workflows/build-packages.yml` follows Cusco's staged-install approach:
Meson installs to a private directory under `/usr`, then `dpkg-deb` and
`rpmbuild` package that identical payload. The build runs in Debian 13
(`debian:trixie-slim`), which supplies libadwaita >= 1.6 for
[`Adw.Spinner`](https://gnome.pages.gitlab.gnome.org/libadwaita/doc/main/class.Spinner.html).
The resulting JavaScript and data packages are architecture independent:
Debian `all` and RPM `noarch`. The RPM dependency names target Fedora.

The workflow runs on pushes to `main`, pull requests targeting `main`, `v*`
tags, and `workflow_dispatch`. It checks JavaScript with the frozen Bun lockfile,
runs Meson's deterministic tests, builds both packages, compares the extracted
payloads, validates desktop integration, and uploads **bolas-packages**. Only
read access to repository contents is required. Packages are workflow artifacts;
this workflow does not create GitHub releases or submit to COPR.

## Local build

On Debian 13, install the build dependencies from the workflow's first step.
These include Meson >= 1.2, Ninja, GJS, GTK/libadwaita introspection data,
GLib development tools, GStreamer and GstPbutils introspection data for the
video-export tests, FFmpeg, desktop metadata tools, Python 3, `rpm`,
`cpio`, and `xz-utils`. `dpkg-deb` is supplied by `dpkg`. Bun is needed for
JavaScript linting but is not a package runtime dependency.

```sh
bun install --frozen-lockfile
bun run check
bash scripts/package.sh
bash tests/test-packages.sh
```

Outputs for version 0.1.1 are `dist/bolas_0.1.1_all.deb`,
`dist/bolas-0.1.1-1.noarch.rpm`, and `dist/SHA256SUMS`. Each build uses a fresh
temporary directory and cleans it on exit; it does not reuse `build/` or
include repository files outside Meson's installation list.

Versions come from Meson's project metadata and must use numeric
`MAJOR.MINOR.PATCH`. The script rejects mismatches with `package.json` and
`src/config.js`. On tag builds, the tag must equal `v` plus that version:

```sh
bash scripts/package.sh v0.1.1
```

Branch, pull-request, and manual builds use the project version unchanged.
Their packages are snapshots; a version tag is not required to test packaging.

## Package integration

`build-aux/packaging/` owns the Debian control template, Debian install/removal
cache hook, and RPM spec template. Both packages include the launcher, all
installed modules and backgrounds, symbolic icons, desktop entry, D-Bus
activation service, GSettings schema, and workspace MIME definition.

Dependencies explicitly include GI libraries, GTK's GStreamer media backend,
base/good codecs, and FFmpeg. RPM uses `/usr/bin/ffmpeg` so Fedora's
`ffmpeg-free` and compatible providers can satisfy it. Desktop portals are
recommended for screenshot capture. Debian hooks refresh schema, MIME,
desktop, and icon caches on installation/removal; Fedora's distribution file
triggers perform those updates. Generated system caches are never packaged.

The package verification test extracts into temporary directories without
installing anything or opening a desktop session. It checks checksums,
identity, architecture, installed size, matching contents, required resources, launcher paths,
RPM ownership, executable Debian hooks, and desktop/schema validation. For each
extracted package, an isolated GIO process also resolves the desktop entry by
application ID and checks that it is visible in GNOME, uses the installed
launcher, and names the bundled icon. The process uses temporary XDG user-data
and configuration directories, so user launcher overrides cannot mask a
packaging failure or make the check depend on a live desktop session.

User desktop entries take precedence over system packages. An obsolete
development entry with the same application ID can hide a correct installation;
package upgrades do not change that user file. See the
[missing launcher recovery steps](../user/getting-started.md#bolas-is-missing-from-the-application-grid)
and [incident report](../../postmortem/2026-09-06-development-launcher-hides-installed-app.md).

No project license has been declared in Bolas yet. RPM currently records
`LicenseRef-Proprietary` rather than adopting the license of the Cusco example.
Update that field when the project license is selected.

For installation commands, see [Getting started](../user/getting-started.md).
