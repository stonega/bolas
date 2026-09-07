# Changelog

## [0.1.2] - 2026-09-07

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
