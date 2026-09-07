# Getting started

## Install a native package

Download the **bolas-packages** artifact from a successful **Build packages**
GitHub Actions run and extract it. From that directory, verify the downloads
with `sha256sum --check SHA256SUMS`, then install the package for your system:

```sh
# Debian 13 or a compatible distribution with libadwaita >= 1.6
sudo apt install ./bolas_*.deb

# Fedora
sudo dnf install ./bolas-*.noarch.rpm
```

These commands install the required GNOME libraries and media tools. Start
**Bolas** from the application grid or run `bolas`. A working desktop portal
backend is needed for screenshot capture. Additional video formats may require
your distribution's optional GStreamer codecs.

## Bolas is missing from the application grid

An old development launcher can override the installed package's desktop entry.
This affects profiles used with an earlier development setup: its user-local
`io.github.stonega.Bolas.desktop` entry contains `OnlyShowIn=X-BolasDevelopment;`,
which hides the application from GNOME even though the RPM or DEB is installed.
Upgrading the package does not replace user-local desktop entries.

To back up that obsolete entry, run the following without `sudo`. It only moves
an entry marked as a Bolas development launcher and preserves an existing backup:

```sh
desktop_entry="${XDG_DATA_HOME:-$HOME/.local/share}/applications/io.github.stonega.Bolas.desktop"
if [ -f "$desktop_entry" ] && grep -Fxq 'X-Bolas-Development=true' "$desktop_entry"; then
  mv --no-clobber -- "$desktop_entry" "$desktop_entry.bolas-development-backup"
fi
```

Reopen the application grid. GNOME can then use the visible launcher installed
at `/usr/share/applications/io.github.stonega.Bolas.desktop`. If the backup
already existed, the command leaves both files unchanged; preserve or rename
that backup before retrying.

## Open and capture

Choose **About Bolas** from the main menu to see the application version and its
shadow-free icon with GNOME-style window controls. When running from source,
restart Bolas after updating its code or artwork; the About dialog uses the icon
from that checkout.

Open Bolas and choose **Take Screenshot** (or press Ctrl+Shift+S) to use the
desktop's screen, window, or area chooser. The captured image opens directly in
the image workspace. Existing still images opened from the chooser, command
line, Files, or the media drawer enter that same workspace immediately. To open
a screenshot or screen recording, choose **Open File**,
press Ctrl+O, pass its path on the command line, or use **Open With Bolas** from
Files. PNG, JPEG, WebP, GIF, TIFF, and BMP images are supported. Common MP4,
WebM, Ogg Video, QuickTime, Matroska, MPEG, AVI, WMV, and 3GPP containers are
accepted when the corresponding system codec is installed.
Editable `.bolas` image and video workspaces are accepted by the same chooser,
command-line, and Files integration and open directly in the matching editor.

Saved projects appear newest-first in the responsive **Recents** grid on the home
page, with their project title and last-edited time below the preview area. Image
projects preview their complete composition from the latest Save; video projects
show the frame at the playhead from the latest Save. Older workspaces and projects
whose previews cannot be decoded use the workspace marker. When projects exist,
use the compact camera button or the primary **Open File** action in the
full-width page header, or select a project to continue editing it. Before the
first project is saved, the labeled
actions remain in the centered empty state.

Choose **Screenshot Folder** beside **Open File** to slide in the media drawer
from the right. Use the tabs at the top to switch between **Screenshots**, which
watches `~/Pictures/Screenshots` (or the desktop's configured Pictures folder),
and **Screencasts**, which watches `~/Videos/Screencasts` (or the desktop's
configured Videos folder). Each tab puts the newest files first and updates when
files are added or removed. Screenshots and screencasts show visual previews;
recordings that cannot be decoded show a video marker instead. The wide drawer
uses a two-column grid of 16:9 previews when space permits. Use the header sidebar
button to show or collapse the drawer, or the close button to the right of the
Screenshots and Screencasts tabs to close it. Select either preview to open it.

Selecting an image, recording, or saved project opens its matching editor
immediately. Image and video editing stay in the same application window and use
native navigation transitions. Still images do not open a second share composer:
add or remove their background inside the image workspace. Transparent,
title-free headers keep the image stage visually continuous, with a white Back
control for contrast. System reduced-motion preferences are respected. Use Back
in either editor to return Home. Unsaved image or video project changes are
protected by a discard confirmation.

## Edit and share a video

Open a recording to enter the composed video workspace. The upper preview and
right-hand controls choose a background, 4:3, 16:9, or square canvas, padding,
rounded corners, and shadow.

The entire composed canvas is the editable picture. Zoom, blur masks, and text
operate on the background, padding, framed recording, and overlays together—not
only on the imported recording. Trimming and audio controls still address the
original clip.

The bottom timeline keeps one playhead across six channels:

- **Video** contains the source clip; drag its left and right handles to trim.
- **Audio** shows the audio channel; adjust volume or mute it independently.
- **Zoom** contains timed focus blocks. When the video opens, Bolas analyzes the
  selected range locally and adds **Input focus** blocks where sustained typing
  or an active caret is visible. Double-click any block to choose center or a
  specific focus point and set its magnification.
- **Speed** retimes video and pitch-preserved audio together.
- **Text** contains captions. Double-click the lane or use **Add Caption**.
- **Masks** contains timed regional blurs for sensitive information.

Click or drag anywhere in the ruler to seek. Double-click an empty effect lane
to add a block at the playhead, select a block to remove it, and use Space to
play or pause. Z, S, T, and M provide keyboard access to zoom, speed, text, and
mask actions. Dragging and playback retain the latest position once per display
frame, so the timeline remains responsive while the video decoder catches up.
Back cancels any running video operation and returns to Home immediately. You do
not need to wait for the initial automatic-focus scan to finish, and the live
video canvas is not animated during that navigation.

Choose **Auto Focus** to analyze the current trimmed range again. Rerunning it
replaces generated input-focus blocks while preserving zoom blocks you added or
edited yourself. Detection is based only on visible pixel changes, so animated
pages can occasionally need a block adjusted or deleted. Analysis samples stay
on the computer and are removed immediately after the scan.

Use **Save** or Ctrl+S to create or update an editable `.bolas` video workspace in
Bolas's private project library. It embeds the source recording, trim, audio,
speed, zoom, captions, masks, share-canvas settings, and playhead, so reopening it
does not depend on the original recording path. The embedded source is limited to
128 MiB; larger recordings remain editable and exportable but cannot be saved as
a portable workspace.

Use **Export…** or Ctrl+Shift+E to render a new WebM with VP9 video and optional
Opus audio, or use the share button to render into private cache and choose
another installed application. Long operations can be cancelled, temporary
backdrop and mask files are removed, and neither the source nor an existing
destination is overwritten. Export and Share do not mark project changes saved.

## Edit and share an image

The image workspace opens with a background and the live composition controls
visible. Select from the three-column grid of ten textured mesh backgrounds and
two neutral backgrounds, choose 4:3, 16:9, or square output, then adjust padding,
screenshot corner radius, and the soft two-part shadow. Use Shadow strength to
move from no effect to the full broad blue-navy falloff and tighter black cast.
The screenshot always fits inside the canvas without being cropped. Click the
background whenever you want to return to these composition controls.

With a background active, Draw opens a right-side panel without replacing the
canvas or top bar. The imported image is selected first. Use Select to choose the
image or a canvas annotation; annotations take precedence where they overlap the
image. Click an existing annotation to open the Draw panel with that annotation
selected, including while another panel is open. Choosing a drawing tool targets
the complete canvas, including over the imported image. Crop is the next toolbar
icon after Draw and opens its own right panel without replacing the canvas or top
bar. Its crop, rotate, and flip actions always target the imported image without
moving or flattening canvas annotations.
Background follows Crop; use it, or click empty background from Crop or Draw's
Select tool, to return to the composition settings.

Use **Save** or Ctrl+S to create or update an editable `.bolas` workspace in
Bolas's private project library. The first save chooses a readable, collision-free
name automatically; later saves update that project atomically. **Export…** creates
a flattened PNG at a chosen destination, while the share button renders a
temporary PNG and opens the application chooser. The canvas itself—including the
background, rounded corners, and shadow—is included in exported and shared images.

A `.bolas` file embeds the normalized source image, image and canvas annotations,
crop/rotate/flip transforms, composition settings, active editor state, and undo
and redo history. It does not depend on the original image path. Exporting or
sharing does not mark workspace changes as saved, so closing after an export still
warns when the editable project has not been saved.

When the source PNG contains transparency, Bolas preserves its original soft
edges and embedded shadow over the chosen background. Corner radius and the
additional shadow are disabled for that image so transparent gradients are not
clipped or surrounded by a rectangular effect.

The editor and exporter never silently overwrite the original image or an external
workspace. Managed workspace files and their recovery backups use private
permissions. Captured screenshots and temporary share files are stored privately
below the user cache directory; use **Export…** when you want a durable flattened
image in a chosen location.
