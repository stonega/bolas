# Installed launcher stalls workspace saving and image export

## What happened

An installed Fedora RPM opened images and displayed the editor, but workspace
Save and image Export did not finish. The issue was reproduced with the launcher's
import statement and a bounded headless GLib main-loop test on GJS 1.88.1.

## Impact

Save could remain on Saving before writing a workspace. Export could stop after
the destination chooser resolved. Other Promise-based desktop operations were
also exposed to the same stall. Native packages and Flatpak use the affected
Meson launcher; source launches invoke `src/main.js` directly.

## Root cause

`src/bolas.in` used `await import(...)` to load `main.js`. That module calls
`Gio.Application.run()`, which enters a synchronous main loop before the dynamic
import finishes. Native callbacks still run, but Promise continuations cannot
resume inside that unfinished import. Save first awaits static-image acceptance;
Export awaits the destination chooser, so neither can continue normally.

All 27 pre-existing tests passed outside the tool sandbox because they loaded
services directly and did not exercise the installed launcher's import boundary.
The initial sandbox-only codec failures were unrelated to this regression.

## Fix

Use a static import in the installed launcher. It retains the same configured
module URI and application arguments while allowing Promise continuations to
run during the main loop. No screenshot, workspace format, filesystem permission,
or codec change is required.

## Prevention and follow-up

- Run a headless integration test through the generated launcher that saves,
  reopens, and updates a synthetic workspace, then exports edited PNG and JPEG
  images. A deadline turns a stalled continuation into a deterministic failure.
- Run that same check against both extracted native packages; include the
  generated-launcher check in the Meson suite used by COPR release builds.
- Include the fix in the next package release and restart affected installations
  after updating. Previously saved workspaces remain compatible.
