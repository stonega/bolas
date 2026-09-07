# Packaging build missing the SVG loader

## What happened

The package workflow for commit `bacb8fd` failed in the bundled-icon test while
decoding the application SVG. The same test passed on the development host.
The failure was found while preparing version 0.1.2.

## Impact

The main-branch build produced no DEB or RPM artifacts. No affected release
was published; version 0.1.1 remained available.

## Root cause

The updated icon test renders the actual SVG through GdkPixbuf. Debian provides
that decoder in `librsvg2-common`, which was absent from the minimal CI image.
The workflow uses `--no-install-recommends`, so installing GTK and GdkPixbuf
alone did not bring in the loader. The development host already had SVG support.

## Fix

List `librsvg2-common` explicitly in the workflow's dependency installation and
document it among the local packaging prerequisites.

## Prevention and follow-up

Keep the icon rendering test mandatory in the minimal Debian environment.
Require a successful package build, including package and desktop-integration
validation, before publishing release assets. New format-dependent tests must
declare their decoder dependencies in the build environment.

## Evidence

- [Failed packaging build](https://github.com/stonega/bolas/actions/runs/34089935875)
- [Debian SVG loader package](https://packages.debian.org/trixie/librsvg2-common)
