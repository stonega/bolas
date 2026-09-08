# Architecture

## Product boundary

Bolas is a native GNOME application for capturing or opening screenshots,
opening and composing screen recordings with multitrack video/audio edits,
annotating still images, and creating presentation-ready share images and videos.
Screen capture is delegated to the secure XDG Desktop Portal; Bolas does not
depend on a browser runtime, GNOME Shell private APIs, or an external AI client.

## Technology choices

- **GJS** provides modern JavaScript modules over GNOME platform libraries.
- **GTK 4 and libadwaita** provide lifecycle, native controls, accessibility,
  file dialogs, and GNOME visual behavior.
- **GtkMediaFile and GtkPicture** provide native, codec-aware video playback in
  the composed editor preview.
- **FFmpeg** provides deterministic, cancellable WebM and MP4 rendering for video edits.
- **Cairo and GdkPixbuf** provide deterministic image composition and PNG/JPEG export.
- **Gio and GLib** provide private, atomic `.bolas` workspace persistence and gzip framing.
- **Meson and Ninja** own configuration, tests, and installation.
- **Flatpak** provides a sandboxed distribution and permission boundary.
- **DEB and RPM packages** distribute the same Meson installation for native
  Debian and Fedora systems, using distribution-provided GNOME and media libraries.
- **Fedora COPR** builds release sources for x86_64 and aarch64. Bolas is
  GPL-3.0-or-later licensed; every native installation includes its license text.
- **Biome** formats and statically checks repository JavaScript only.

The UI uses system typography and libadwaita colors. A restrained four-corner
frame is the home view's visual signature; color is concentrated in the content
being created rather than in application chrome.

The application icon uses the same product metaphor: a colorful share canvas
behind a light screenshot frame, with the original Bolas focus orb preserved as
the central identity mark. The screenshot uses a GNOME-style header bar with a
centered title mark and one close button on the right. Its SVG artwork has no
shadow filters, and the About dialog suppresses the theme's icon shadow for a
clean, shadow-free presentation.
Source launches prepend `data/icons` to GTK's icon search paths so About uses the
current repository artwork even when an older Bolas package is installed.
It verifies the resolved icon and appends the source path instead when GTK uses
reverse directory precedence, as in GTK 4.18. Existing theme paths remain available.

## Runtime modules

```text
main.js
  └── BolasApplication
        ├── BolasWindow
        │     ├── Recents home backed by the private workspace library
        │     ├── monitored screenshot-folder drawer
        │     ├── unified image edit/share workspace
        │     │     ├── independently editable image and canvas documents
        │     │     ├── background, layout, annotation, and geometry controls
        │     │     ├── versioned `.bolas` persistence with embedded source and history
        │     │     └── flattened PNG/JPEG export and PNG app handoff
        │     ├── multitrack share-video workspace
        │     │     ├── video, audio, zoom, speed, text, and mask lanes
        │     │     ├── shared background and canvas controls
        │     │     ├── versioned `.bolas` persistence with embedded recording
        │     │     └── composed video preview/export
        ├── managed workspace-library and screenshot-folder models
        ├── screenshot-capture portal service
        └── atomic video-export service
```

Stable identifiers and window defaults live in `config.js`, which is deliberately
free of GTK imports and can be tested without starting a display server.
The installed launcher statically imports `main.js`. Dynamic import would keep
module evaluation pending while `Gio.Application.run()` runs its synchronous
main loop, preventing Promise continuations in Save, Export, and other desktop
operations from resuming. Source and installed launches must preserve the same
asynchronous behavior.
Durable editor and image-composition choices live behind `preferences.js`, which
validates the supported values and stores them with the application GSettings
schema. Widgets remember an option when the user changes its control and restore
all options when a new workspace is created.

## Media-open boundary

`BolasApplication` uses `Gio.ApplicationFlags.HANDLES_OPEN`, so desktop file
activation and command-line paths enter through one code path. `media-file.js`
accepts absolute local paths, verifies that the file exists, classifies videos by
their registered content type, and delegates still-image decoding and dimension
inspection to `image-file.js`. The desktop entry advertises the same common
containers accepted by the file chooser.

Validated images, videos, and workspaces enter their matching editor directly.
Still images use `GtkPicture`. The video editor owns a `GtkMediaFile` and exposes
it through a composed `GtkPicture` preview. Playback errors are reported without
blocking the main loop. Available codecs come from the host or Flatpak runtime
media stack; recognizing a container does not imply that every codec inside it
is installed.

The main window also exposes a right-side media drawer with a native
`Adw.ViewSwitcher` at the top. Its Screenshots tab monitors the standard
`Pictures/Screenshots` directory and admits supported image extensions. Its
Screencasts tab independently monitors `Videos/Screencasts` and admits supported
video extensions. Each `Gtk.DirectoryList` loads without blocking the GTK main
loop. The drawer occupies most of the window width, with a 600 px minimum, so its
two-column grid remains useful rather than collapsing into a narrow strip. Every
image and recording preview uses the same responsive 16:9 frame. Recordings use
a bounded two-job FFmpeg queue to extract one representative frame into a
private, size-limited cache.
Recycled grid cells cancel queued or active work, and recordings that cannot be
decoded retain a video-marker fallback. Selecting either kind enters the same
validated file-open path as the chooser.

Saved video workspaces use that same bounded thumbnail service to capture the
saved playhead, clamped inside the selected trim. The frame is copied into the
workspace's private preview sidecar after the workspace write succeeds, so the
home Recents grid can show video covers without opening or decoding workspace
payloads. Cover failure leaves the saved project valid and falls back to the
workspace marker.

The main header exposes a right-sidebar toggle without duplicating the file-open
action already available from the main menu, keyboard shortcut, and home view.
The drawer header keeps a separate close button immediately to the right of its
Screenshots and Screencasts switcher.

## Screenshot-capture boundary

`services/screenshot-capture.js` owns the XDG Desktop Portal request lifecycle.
It requests the desktop's interactive screenshot chooser, distinguishes success,
cancellation, denial, timeout, and backend failure, and supports cancellation
when the application closes. The portal result is copied asynchronously into a
private, collision-resistant cache file before entering the normal image-open
path; widgets never call D-Bus or retain a temporary portal URI.

## Editor boundary

The editor has focused native boundaries for document history and geometry,
workspace schema, workspace file persistence, deterministic Cairo
rendering/export, and the GTK/libadwaita image workspace.
Editing remains non-destructive until export. Still images and videos open
directly in their workspace instead of stopping at an intermediate viewer.

Still images start with a background composition enabled. This creates a second
canvas document and makes it the default edit target. Canvas operations address
the complete background-plus-image result. Draw, Crop, and Background live beside
the zoom controls and open peer contextual right-side panels without replacing
the viewer header or canvas. Draw starts with Select active and the imported image
selected; canvas annotations retain hit-test precedence, while choosing a drawing
tool returns the active target to the canvas document. Text uses the system Sans
family by default and exposes the native font-family chooser in the Draw panel.
The Draw tool grid uses one bundled thin-line symbolic SVG set, including an
arrow cursor for Select, so its meaning and weight do not vary by host icon theme.
Clicking an existing annotation opens the Draw panel with that annotation selected
before empty imported-image and background clicks route to Crop and Background.
This direct panel routing remains active in the viewer, Crop, and Draw's Select
tool; drawing gestures keep their active drawing tool. Crop always maps pointer
input back through canvas transforms and applies crop, rotate, and flip operations
only to the imported-image document. Clicking the background opens its composition
controls. Preview, export, and app handoff all flatten the same live two-document
state. Fit derives its bounds from the composed canvas ratio and canvas transforms
whenever a background is active, independent of the currently selected layer.

`editor/workspace.js` and `video/workspace.js` are the versioned media-specific
workspace boundaries; `model/workspace.js` owns their common schema, embedded
asset validation, checksum, and size rules. `services/workspace-file.js` dispatches
by manifest kind and owns magic-header detection, gzip framing, cancellable reads,
and atomic private writes. Image workspaces embed an orientation-normalized PNG.
Dedicated image document snapshots preserve current state, selection, and capped
undo/redo stacks without changing the smaller `toJSON()` representation used by
rendering and dirty fingerprints.

The video editor is a separate native workspace because timeline edits and image
annotations have different data models. Above the timeline it reuses the image
workspace's background, ratio, padding, corner-radius, and shadow controls. The
editor displays its managed `GtkMediaFile` directly as a `GdkPaintable` in a
shrinkable, contain-fitted `GtkPicture`, preserving the recording's intrinsic
aspect ratio without cropping or stretching. It does not embed `GtkVideo`'s
standalone player surface or black letterbox behind the recording. The fitted
recording is allocated inside symmetric canvas margins derived from the shared
padding setting, rather than using GTK minimum-size requests. The bottom timeline
has one shared ruler and playhead across video, audio, zoom, speed, text, and
blur-mask lanes. Every visible block can be selected and resized from either
edge. The video, audio, and global speed blocks share the clip trim boundaries;
timed zoom, caption, and mask blocks keep independent ranges and can be added,
selected, configured, resized, and removed. The audio lane also exposes mute and
volume, and speed retimes both video and audio.

The video workspace treats the composed preview as its primary flexible region.
Its right settings column stays at a fixed 370 px width and does not propagate
the controls' natural width into the horizontal layout, so widening the window
allocates all additional space to the preview.

Video Save snapshots the normalized timeline, share canvas, and playhead and
embeds the original source bytes in the same `.bolas` container used by image
projects. On reopen, `services/video-workspace-source.js` checksum-verifies and
materializes the source into a private, uniquely named cache file for GTK and
FFmpeg, then removes it when the editor is disposed. Loading dispatches by the
manifest's explicit `kind`; image version 1 files remain unchanged. Automatic
focus does not rerun for restored projects. A successful workspace write, not a
video export or application handoff, advances the video editor's saved fingerprint.

Both editors show workspace-save progress on the existing Save button: it reads
Saving and remains disabled from preparation through preview generation. The
button returns to Save when the operation finishes, including failure or
cancellation. Workspace saves do not add a separate cancel button.

The imported recording is the video editor's visual-effect boundary. Timed zoom
and regional blur use source-video coordinates and are clipped inside the
rounded recording. The background, shadow, padding, and canvas dimensions remain
outside those effects, while captions belong to the composed canvas. Trim and
audio controls continue to address the imported media stream.

An active blur region can be selected directly on the recording. Its interior
moves the region and eight visible edge and corner handles resize it, with all
geometry clamped to the source-video bounds and stored in the same normalized
coordinates used by preview, persistence, and export. The timeline remains the
source for effect timing and selection; the canvas is a direct geometry editor.
Arrow keys move a selected region, and Shift+Arrow resizes its bottom or right
edge so the interaction does not depend on pointer input.

Timeline pointer events and media notifications are coalesced against GTK's
frame clock. While the media is playing, one continuous frame-clock callback
updates the playhead, active overlay, and GSK recording transform at the display
refresh cadence. The media paintable invalidates itself as decoded frames arrive;
the playback callback does not request a second video redraw. Its monotonic
playback clock fills the gaps between backend timestamp reports without moving
backwards when a late report arrives. Full widget layout and Cairo backdrop
painting remain reserved for source or share-canvas changes. This keeps decoding
and interaction from creating redundant work on the GTK main loop.

On first entry, the video workspace starts a bounded local analysis of the
selected clip. `services/video-auto-focus.js` asks FFmpeg for no more than 480
grayscale, 320-pixel-wide samples and loads each frame asynchronously before its
bounded comparison so the GTK main loop remains responsive. Pure domain logic in
`video/auto-focus.js` rejects
whole-frame motion, groups repeated localized changes, and turns sustained
typing or caret activity into focus-point zoom blocks. Generated blocks remain
editable and distinguishable from user-authored blocks; rerunning analysis
replaces only untouched generated results. Samples live in a private temporary
directory, are never logged or transmitted, and are removed after success,
cancellation, or failure.

`services/video-export.js` turns the normalized timeline into one deterministic
FFmpeg filter graph. It trims the source, applies timed regional blur and zoom to
the imported recording, scales and rounds that result, and composites it over a
backdrop painted by the same Cairo share renderer. Captions and speed are applied
after composition. Export runs without a shell, supports cancellation, writes
private temporary assets, and atomically moves the completed VP9/Opus WebM or H.264/AAC MP4
without replacing the source or an existing destination. Edited videos can be
handed directly to another application through `Gtk.FileLauncher`.

Both editors use the shared native export dialog in `window.js`. Format selection
precedes the standard destination chooser; the same modal then shows progress,
cancellation, errors with retry, and completion. Video percentages come from
FFmpeg output timestamps divided by the trimmed, speed-adjusted duration. Image
exports show a pulsing bar with actual preparation, rendering, and encoding
stages. `services/image-export.js` snapshots the live documents and asynchronously
saves the oriented source, then a separate GJS worker uses the existing Cairo
renderer. Large image rendering and encoding do not block GTK. Both services
publish a completed private file without overwriting an existing destination;
100% is reported only after publication. Cancellation reaps the worker before
removing its staging files.

Focus blocks use the same cosine-eased 250 ms scale envelope in the live GTK
preview and FFmpeg export. Automatic detections retain their source-video point,
which is clamped inside the imported recording. Changing ratio or padding only
changes the recording's placement and leaves the focus attached to the same
input content.

Home, the unified image editor, and the video editor are pages of the main
application window. Editor and backward navigation use native libadwaita
push/pop transitions. Image and video activation push the matching editor
immediately, and Home is both editors' Back destination. Image Back navigation
uses the native pop transition. Video Back first cancels active analysis,
export, queued interaction work, and playback, then uses a non-animated
programmatic pop so the live composed preview is not rendered through an
expensive outgoing transform. Outgoing workspace resources are released after
the page is hidden.

Workspace title-free headers float transparently over the image stage with a
high-contrast white Back control on the left and the native window Close control
on the right. Image and video Back navigation return to Home. Closing or leaving
a dirty editor still requires explicit discard confirmation.

## Image-composition boundary

`share/renderer.js` is independent of widgets. Given a source pixbuf or rendered
editor surface and normalized options, it paints a bundled shader-texture canvas, fits the
screenshot without cropping, clips rounded corners, adds an optional shadow with
a broad navy cast (`rgba(50, 50, 93, 0.25) 0 50px 100px -20px`) above a tighter
black cast (`rgba(0, 0, 0, 0.3) 0 30px 60px -30px`), and exports an atomic PNG.
Deterministic layered approximations reproduce both CSS-style blurs in Cairo.
The shadow-strength control scales both layers' opacity together from zero to
their declared values. The same painter drives the live preview and
full-resolution output. Neutral Paper and Graphite presets remain lightweight
procedural fallbacks.

The live image workspace keeps interaction within the GTK frame budget by
rendering from a bounded preview pixbuf and caching the composed Cairo surface
until a document or setting changes. Full-resolution pixels remain the source of
truth for export. Background controls use bundled swatch-sized copies of the
canvas artwork, so opening the sidebar never decodes every full canvas asset.

Sources containing non-opaque pixels keep their alpha silhouette unchanged.
Their transparent gradients are composited directly over the selected background;
synthetic corner clipping and rectangular shadows are reserved for opaque sources
so they cannot overwrite an image's own antialiased edge or embedded shadow.
For transparent sources, corner radius and shadow are disabled only in the active
workspace. Their remembered values remain intact for the next opaque source.

The workspace offers fixed, predictable canvases:

- 4:3 at 1600 × 1200;
- 16:9 at 1600 × 900;
- 1:1 at 1600 × 1600.

App handoff uses private, collision-resistant files below the user cache. Save
creates or atomically updates the editable `.bolas` workspace below
`$XDG_DATA_HOME/io.github.stonega.Bolas/workspaces`, retaining a recoverable
previous file during replacement. The home page monitors that private directory
and presents its projects newest-first as rectangular preview cards in a
responsive, full-width Recents grid. Each successful image Save atomically
refreshes a private, bounded PNG sidecar rendered from the complete saved
composition. Home loads only that small derivative and validates that it is not older than the
workspace; it never decodes a full `.bolas` payload merely to populate the grid.
Video projects and missing, stale, or unreadable image previews retain the
workspace-marker fallback. The preview occupies the flexible upper area of each
card, with the workspace title and last-edited subtitle grouped beneath it at the
bottom. The populated page header spans the same content width, uses a restrained title size,
and places the compact screenshot icon immediately before the primary Open File
action. Both header controls share the same compact height. The header and grid
share a compact outer inset so titles, actions, and preview cards align while
making use of the available window width. Compact vertical insets and a short
header-to-grid gap keep the projects close to the page controls. Opening an
external workspace remains supported, but Save imports it into the managed
library instead of modifying the external file. Export uses the standard save
dialog after choosing PNG/JPEG or WebM/MP4 in the export modal. Export and app handoff never clear workspace
dirty state. None of these actions replaces the source media or an unrelated
existing destination.

Recents cards are activatable launchers rather than selectable content. Their GTK
grid therefore uses a no-selection model: pointer hover is transient, keyboard
focus remains visible, and returning from a workspace cannot leave a card with a
selected-state treatment that resembles a stuck hover.

The background and canvas control builder is shared by image and video
workspaces. This keeps preset selection, ratios, padding, rounded corners,
shadows, remembered preferences, and output dimensions identical across both
share formats. In the image workspace, the chooser starts with a None item that
removes the presentation canvas without discarding its settings or annotations.
The background chooser reflows with the available sidebar width while preserving
a three-column minimum so every preset remains easy to scan.

## Data and privacy

- Screenshot pixels and paths are sensitive user data.
- Workspace files live in a user-only managed data directory, embed screenshot
  pixels, omit the original absolute source path, and validate declared sizes and
  SHA-256 digests.
- Portal captures are copied into private cache files with user-only permissions.
- Managed editor files are private user data; transient share files live in cache.
- Transient edited videos are written below the private user cache before app handoff.
- Cached screencast preview frames use hashed filenames, user-only permissions,
  and a bounded entry count below the private user cache.
- Edited video exports omit source-container metadata and use user-only file permissions.
- Editor and image-composition preferences contain option values only, never image
  contents or paths.
- Existing destinations are never overwritten silently.
- Logging does not include image pixels or full private paths by default.
- Opened video contents and paths receive the same sensitive-data treatment.
- Flatpak permissions stay narrow and use GTK desktop integration for file access.

## Testing strategy

- Unit tests cover configuration, image and video classification, editor geometry,
  and export.
- Workspace tests cover schema normalization, source checksums, source-PNG
  round trips, selections, undo/redo restoration, atomic updates, etag conflicts,
  existing-destination refusal, and future-version rejection.
- Video tests cover trim and timeline normalization, timestamp labels, speed and
  audio state, generated zoom/caption/mask/share filter graphs, composed canvas
  dimensions, muted and unmuted WebM rendering, MP4 codecs, progress, cancellation, and atomic destinations.
- Image-export tests compare the worker's pixels with the editor renderer, verify
  PNG transparency and white JPEG flattening, and cover progress, cancellation,
  private permissions, and existing-destination refusal.
- Automatic-focus tests cover bounded sample rates, localized typing detection,
  whole-frame-motion rejection, generated focus geometry, and preview easing.
- Screenshot-capture tests cover request paths, responses, private destinations,
  and asynchronous persistence without opening a real desktop dialog.
- Screencast-preview tests cover cache identity, bounded FFmpeg output, private
  permissions, cache reuse, concurrency limits, and cancellation.
- Share-renderer tests cover every canvas ratio, option normalization, preview
  geometry, and PNG output. Editor-renderer tests cover two-document composition,
  full-canvas export, and reversible image-layer mapping through canvas crop,
  rotation, and flips.
- Preference tests use the in-memory GSettings backend and verify every restored
  editor and share option without touching the user's desktop settings.
- Filesystem tests use private temporary directories and never open a desktop dialog.
- UI smoke tests run separately in a disposable graphical session.
