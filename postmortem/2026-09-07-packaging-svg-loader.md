# Packaging build missing the SVG loader

## What happened

The package workflow for commit `bacb8fd` failed in the bundled-icon test while
decoding the application SVG. The same test passed on the development host.
The failure was found while preparing version 0.1.2. After adding the loader,
the next build exposed reversed icon lookup precedence in Debian's GTK 4.18.

## Impact

The main-branch build produced no DEB or RPM artifacts. No affected release
was published; version 0.1.1 remained available.

## Root cause

The updated icon test renders the actual SVG through GdkPixbuf. Debian provides
that decoder in `librsvg2-common`, which was absent from the minimal CI image.
The workflow uses `--no-install-recommends`, so installing GTK and GdkPixbuf
alone did not bring in the loader. The development host already had SVG support.
It also used a newer GTK with different search-path precedence: GTK 4.18 visits
duplicate theme directories in reverse order, allowing the test's stale
installed icon to win over the prepended source path.

## Fix

List `librsvg2-common` explicitly in the workflow's dependency installation and
document it among the local packaging prerequisites.

After registering source icons, verify the resolved application icon. If GTK
selected another file, append the source path instead while preserving all
other paths. The existing lookup test now reports the resolved and expected
paths and checks that repeated registration preserves source icon priority.
The fix passes the icon test in the Debian 13 container.

## Prevention and follow-up

Keep the icon rendering test mandatory in the minimal Debian environment.
Require a successful package build, including package and desktop-integration
validation, before publishing release assets. New format-dependent tests must
declare their decoder dependencies in the build environment.
Keep testing source icon precedence on both the development host and Debian.

## Evidence

- [Failed packaging build](https://github.com/stonega/bolas/actions/runs/34089935875)
- [GTK search-order failure](https://github.com/stonega/bolas/actions/runs/34090418710)
- [Debian SVG loader package](https://packages.debian.org/trixie/librsvg2-common)
