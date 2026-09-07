# Changelog

## [0.1.3] - 2026-09-07

- Support Fedora COPR's optional H.264 codec environment in the video-export
  tests, verifying export failure and cleanup when only noopenh264 is installed.
- Keep full MP4 codec, audio, trim, and speed checks on systems with a working
  encoder; all WebM and destination-protection checks run in both environments.

## [0.1.2] - 2026-09-07

- License Bolas under GPL-3.0-or-later and add Fedora COPR source packaging.
- Add a shared image and video export dialog with format selection, progress,
  cancellation, and retry after errors.
- Support JPEG image export and H.264/AAC MP4 video export alongside PNG and WebM.
- Render and encode image exports in a background worker to keep the editor
  responsive, with private staging files and protection against overwriting
  existing destinations.
- Show workspace-save progress on the Save button.
- Refresh the application icon and use the current bundled artwork in source
  launches and the About dialog.
- Add an image-composer screenshot to the README and document the export workflow.
- Install the SVG loader explicitly in the minimal Debian packaging environment
  so application-icon rendering checks pass in CI.
- Keep source-launch icon priority correct with GTK 4.18's reverse search order.

## [0.1.1] - 2026-09-06

- Document recovery when an obsolete user-local development launcher hides an
  installed Bolas application from GNOME's application grid.
- Verify that GIO discovers a visible launcher with the expected executable and
  icon in both DEB and RPM packages.
- Record the cause and resolution of the development-launcher incident.

The affected user profile was repaired by backing up its obsolete development
entry. This release does not automatically modify user-local desktop overrides.

## [0.1.0] - 2026-09-06

- Initial native GNOME screenshot capture, image composition, and video editing
  release, with portable `.bolas` workspaces and PNG/WebM export.
- Add tested DEB and RPM builds through GitHub Actions.
