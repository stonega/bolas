# Changelog

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
