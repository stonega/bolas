# Native packaging

MP4 export uses the host FFmpeg H.264 encoder: x264 when available, or OpenH264
on distributions shipping that implementation. AAC is used for MP4 audio.
WebM retains VP9/Opus. The export dialog reports missing encoder support and
allows another format to be selected. The image export worker uses the existing
GJS, Cairo, and GdkPixbuf dependencies and is installed with the service modules.

The generated `bin/bolas` launcher uses a static import of the installed
`main.js`. Do not wrap it in `await import(...)`: its synchronous application
main loop would run inside an unfinished dynamic import, starving Promise
continuations. That left Save stuck on Saving and Export waiting after the file
chooser in affected packages, even though direct source tests passed.

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
video-export tests, FFmpeg, `librsvg2-common` for GdkPixbuf SVG decoding,
desktop metadata tools, Python 3, `rpm`,
`cpio`, and `xz-utils`. `dpkg-deb` is supplied by `dpkg`. Bun is needed for
JavaScript linting but is not a package runtime dependency.

The minimal CI image installs packages with `--no-install-recommends`, so the
SVG loader must be listed explicitly. The bundled-icon test decodes the real
application SVG and fails if the loader is missing; keep that rendering check
enabled in headless package builds.

```sh
bun install --frozen-lockfile
bun run check
bash scripts/package.sh
bash tests/test-packages.sh
```

Outputs for version 0.1.3 are `dist/bolas_0.1.3_all.deb`,
`dist/bolas-0.1.3-1.noarch.rpm`, and `dist/SHA256SUMS`. Each build uses a fresh
temporary directory and cleans it on exit; it does not reuse `build/` or
include repository files outside Meson's installation list.

Versions come from Meson's project metadata and must use numeric
`MAJOR.MINOR.PATCH`. The script rejects mismatches with `package.json` and
`src/config.js`. On tag builds, the tag must equal `v` plus that version:

```sh
bash scripts/package.sh v0.1.3
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

The `installed-launcher` Meson integration test runs the generated launcher with
a headless main-loop fixture, a synthetic image, and temporary output paths. It
keeps the launcher's import statement intact and verifies workspace creation,
reopening, updating, and completed PNG/JPEG exports before a fixed deadline.
Package verification repeats the test against each extracted package's launcher
and service modules. The Meson check also runs in COPR when it builds release
sources containing this test. No desktop dialog or existing user workspace is
involved.

User desktop entries take precedence over system packages. An obsolete
development entry with the same application ID can hide a correct installation;
package upgrades do not change that user file. See the
[missing launcher recovery steps](../user/getting-started.md#bolas-is-missing-from-the-application-grid)
and [incident report](../../postmortem/2026-09-06-development-launcher-hides-installed-app.md).

Bolas is licensed under `GPL-3.0-or-later`. Meson installs the complete
`LICENSE` text to `/usr/share/licenses/bolas/LICENSE` in both native packages.
Both RPM recipes declare the same SPDX license and mark the text with
`%license`. Package verification checks the license metadata and installed text.

## Fedora COPR

The [stonegate/bolas project](https://copr.fedorainfracloud.org/coprs/stonegate/bolas/)
is configured for Fedora 43, 44, 45, and Rawhide on x86_64 and aarch64.

`build-aux/packaging/bolas-copr.spec` builds from a GitHub release tag through
Meson's Fedora RPM macros, runs the deterministic test suite, and validates
desktop metadata and schemas. Its initial version is 0.1.2. Release sources
include the GPL license text; COPR rebuilds the application using each target's
distribution dependencies.

Fedora build roots install `noopenh264`, which exposes the OpenH264 interface
without encoding H.264. The integration test probes a synthetic frame before
the MP4 round trip. When neither H.264 encoder works, it instead verifies an
encoding error, no published output, staging cleanup, and destination protection.
Full MP4 round trips still run on codec-equipped hosts and in Debian CI; all
WebM tests run everywhere. See the
[initial build incident](../../postmortem/2026-09-07-copr-optional-h264.md).

After validating the packages and pushing the matching release tag, submit with:

```sh
copr-cli build stonegate/bolas build-aux/packaging/bolas-copr.spec
```

The CLI reads existing credentials from `~/.config/copr` and waits for every
configured target. Only announce the Fedora package after all targets succeed.
This manual publishing path does not copy credentials into the repository.

For installation commands, see [Getting started](../user/getting-started.md).
