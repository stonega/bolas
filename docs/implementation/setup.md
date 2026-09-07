# Development setup

## Native dependencies

Bolas needs GJS, GTK 4, GdkPixbuf, libadwaita 1.6 or newer, Meson, Ninja,
`glib-compile-schemas`, and FFmpeg. Video playback uses GTK's media backend and
therefore also needs the relevant GStreamer codecs. Multitrack timeline and
share-canvas exports use FFmpeg's VP9 and Opus encoders plus its zoompan,
drawtext, boxblur, and compositing filters.
Source modules use explicit GI versions. Verify the runtime imports with:

```sh
gjs -c "imports.gi.versions.Gtk = '4.0'; print(imports.gi.Gtk.MAJOR_VERSION)"
gjs -c "print(imports.gi.Adw.MAJOR_VERSION)"
ffmpeg -hide_banner -encoders | grep -E 'libvpx-vp9|libopus'
```

Install JavaScript development tooling with `bun install`.

The source launcher and `src/main.js` compile the application GSettings schema
into `build/data` before launch. This keeps both `bun run run` and direct
`gjs -m src/main.js` runs on the same persistent preference backend as installed
and Flatpak builds. Application startup also prepends `data/icons` to GTK's icon
search paths for source runs, ensuring the repository's hicolor SVG takes
precedence over an older installed icon. Installed builds keep normal theme lookup.

## Development loop

Launch the home page or open a screenshot or screen recording directly in its
editor:

```sh
bun run run
bun run run -- /path/to/screenshot.png
bun run run -- /path/to/recording.webm
gjs -m src/main.js
```

The home screen's **Take Screenshot** action uses the XDG Desktop Portal. The
desktop owns the interactive screen, window, or area chooser; no additional
Flatpak screenshot permission is required.

The **Screenshot Folder** action opens a drawer with top tabs backed by two
independent monitored directory models. **Screenshots** reads the desktop's
configured Pictures directory and appends `Screenshots` (normally
`~/Pictures/Screenshots`). **Screencasts** reads the configured Videos directory
and appends `Screencasts` (normally `~/Videos/Screencasts`, and specifically
`/home/stone/Videos/Screencasts` with the current desktop configuration). Either
directory may be absent when the application starts; its tab shows an
explanatory state until the directory becomes available. The drawer requests
600–760 px and prefers 68% of the window width, providing at least twice the
original minimum width while remaining an adaptive native overlay.
Both media tabs allocate each card preview through a 16:9 `GtkAspectFrame`, so
resizing the drawer changes preview height proportionally. The right-sidebar
toggle remains in the main header, while a separate close button follows the
Screenshots and Screencasts tabs inside the drawer. File opening remains available
from Ctrl+O, the main menu, and the home view. When saved workspaces exist, verify
that the Recents header and grid use the available page width, workspace cards
use a rectangular preview-first layout with title and last-edited subtitle at the
bottom, reflow from four columns down to one
as the window narrows, and the compact screenshot icon sits immediately left of
the primary **Open File** button. The Recents heading must use the smaller native
title size. The two header actions must have matching compact heights, and the
header and grid must retain matching tight outer insets, compact top and bottom
spacing, and a short gap between the header and grid while resizing. The empty
home state must retain its centered labeled actions instead of showing the
populated header. Save a workspace with image-layer and canvas-layer edits, return
Home, and verify that its card previews the complete saved composition. Change
and save it again to confirm the preview refreshes. Removing or damaging only the
preview sidecar must show the fallback icon without making the workspace
unreadable.

Move the pointer across several Recents cards without activating them and confirm
that each hover treatment clears as soon as the pointer leaves. Open a workspace,
return Home, and confirm that its card does not retain a hover-like selected
background. Keyboard focus must remain visible and Enter must still activate the
focused card.
Visible screencast cards request a cached frame near the start of each recording.
At most two FFmpeg thumbnail jobs run together, and scrolling away cancels work
that is no longer needed. Scroll through the list and switch tabs to verify that
recycled cards update to the correct file; an unavailable codec should leave the
video marker visible.

Run the complete local check with `bun run check`. It verifies Biome rules,
configures or reconfigures Meson, compiles the project, runs deterministic tests,
and validates the generated desktop entry when `desktop-file-validate` is present.

The bundled-icon test verifies GTK lookup against a stale installed-icon fixture,
renders the application SVG, and checks that the margin below the canvas stays
transparent. Open **About Bolas** from the main menu and
check the icon in light and dark appearance: neither the artwork nor the scoped
`.bolas-about .icon-dropshadow` styling should cast a shadow.

For an image-workspace check, open a still image from the chooser, command line,
or media drawer. It must enter the editor directly with **Background** enabled
and its settings panel visible. The bottom toolbar order must be **Draw**, **Crop**,
then **Background**. Open Draw and confirm that only the right panel changes, the
viewer header and zoom controls remain in place, and the imported image has a
selection outline. With Select active, canvas annotations must win hit testing;
clicking the imported image where there is no annotation must select the image.
Choosing a drawing tool must return drawing to the complete canvas. Open Crop and
confirm that its standalone right panel replaces Draw without changing the viewer
header or bottom toolbar. Crop, rotate, and flip must affect only the imported
image. From Crop, click an annotation to return to Draw with it selected. With
Draw's Select tool, click empty background to restore the composition settings.
Actual pointer drags must continue moving or resizing annotations and adjusting
crop geometry. The Background icon is the equivalent explicit action. The top
header must not contain duplicate Background, Draw, Crop, or
Image Actions controls. Disable animations in the desktop accessibility settings
to verify that native workspace navigation settles immediately. Use Back and
verify that the image editor returns directly to Home without showing the source
image viewer. A dirty image workspace must still request discard confirmation
before navigating Home.

With Background enabled, press Fit and verify that the complete presentation canvas
is visible regardless of whether the image layer or a canvas annotation was last
selected. Disable Background and verify that Fit returns to the edited image bounds.

For a share-shadow check, enable **Shadow** for an opaque image over the Paper
background and move **Shadow strength** from 0% to 100%. The preview should move
smoothly from no shadow to a broad blue-navy shadow below the image combined with
a tighter black shadow near its lower edge, without a hard outline.

For an alpha-compositing check, open a PNG with a soft transparent edge and choose
**Background**. The selected background must remain visible through every
partially transparent pixel without a rectangular outline, clip, or second shadow.
Corner-radius and shadow controls are unavailable for that source because its alpha
channel already defines the presentation edge.

For an object-selection check, create a canvas annotation over the background.
With Draw's Select tool active, clicking that annotation must select it even when
it overlaps the imported image. Clicking elsewhere over the imported image must
select the image outline; choosing any drawing tool must then restore the canvas
as the active Draw target. Close Draw, click either existing annotation, and
confirm that Draw reopens with the clicked annotation selected. Add a second
annotation there and confirm image crop, rotation, and flip do not move or flatten
either canvas annotation.

For a video editing check, open a recording and confirm that it enters the editor
directly, with an upper workspace matching the image share composer and a ruler
whose playhead spans the Video, Audio, Zoom, Speed, Text, and Masks lanes. Use
Back and verify that the editor returns directly to Home without showing an
intermediate video viewer. Repeat Back while playback is active and while the
initial automatic-focus scan is running; each must stop the video work and return
immediately, without a dropped-frame outgoing animation. Drag both video trim
handles, change audio volume and speed, add automatic and manual zoom blocks, add
a caption and blur mask, and
choose a different background and canvas ratio. Confirm that the selected
background remains visible outside the rounded recording without a solid black
player panel or letterbox. Move **Padding** from its minimum to maximum and
confirm that the recording shrinks symmetrically while keeping its original
aspect ratio without cropping or stretching. Widen the application window and
confirm that the right settings panel remains fixed at 370 px while the left
preview receives the additional width. Export a WebM and verify the
timing, canvas dimensions, caption, blur, zoom, rounded video edge, audio state,
and unchanged source. During zoom and blur, confirm that only the imported
recording changes while its background, shadow, and caption remain fixed. The
same composed result can be shared directly. Confirm
that Export does not clear the unsaved-project warning. Use **Save** to create a
`.bolas` project, return Home, reopen it from Recents, and verify every timeline,
audio, share-canvas, and playhead value. Move the original recording and reopen
the project again to verify playback and Export use the embedded source. A restored
project must not rerun automatic focus. Saving an external project must import it
into Recents rather than overwriting the external file.

For an automatic-focus check, open a screen recording that shows several
characters being typed into a visible field. The initial local scan should add
an **Input focus** block spanning the typing, and playback should ease toward the
typed content and back out. Trim the clip and choose **Auto Focus** to rescan only
that range. A user-created or edited zoom block must survive the rescan. Escape
must cancel a running scan without leaving temporary PGM samples below the
system temporary directory.

During that focus block, confirm that the background, shadow, padding, video,
and caption enlarge and move as one clipped canvas. Changing the canvas ratio or
padding before rescanning must keep the generated focus attached to the same
typed content. The exported WebM must match this complete-canvas preview.

## Meson installation layout

- `bin/bolas`: small GJS module launcher
- `share/bolas/`: application JavaScript, CSS, image/video editors, and share composer
- `share/bolas/icons/`: bundled symbolic icons for the Draw tools
- `share/applications/`: image- and video-aware desktop entry
- `share/dbus-1/services/`: GApplication D-Bus activation entry
- `share/icons/hicolor/scalable/apps/`: application icon

The launcher receives the installed module URI at Meson configure time. Source
development invokes `src/main.js` directly.

## Flatpak

For native `.deb` and `.rpm` builds and the GitHub Actions workflow, see
[Native packaging](packaging.md). These packages use the same Meson installation
layout with `/usr` as the prefix.

The development manifest uses GNOME Platform 49, which provides the required
GJS, GTK 4, GdkPixbuf, libadwaita, GTK media stack, and FFmpeg executable.

```sh
flatpak-builder --user --install --force-clean \
  .flatpak-build build-aux/io.github.stonega.Bolas.json
flatpak run io.github.stonega.Bolas
```

The manifest requests only display sockets and shared IPC. Screenshots use the
XDG Desktop Portal, files are opened and saved through GTK's desktop-integrated
dialogs, and generated share images or edited videos are handed to other
applications through `Gtk.FileLauncher`.

## Identity and versioning

The application ID is `io.github.stonega.Bolas`. Keep `meson.build`,
`package.json`, and `src/config.js` versions synchronized.
