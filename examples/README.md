# Examples

Run the screenshot portal example from the repository root with:

```sh
gjs -m examples/take-screenshot.js
```

The desktop presents its interactive capture chooser. A successful result is
copied into Bolas's private cache and the example prints that local path.

Run the video trim/export example with an input file, a new WebM destination,
optional start and end times in seconds, optional audio removal, and an optional
share canvas using the remembered default composition:

```sh
gjs -m examples/edit-video.js recording.mp4 edited.webm 2.5 12 --mute --share
```

The example discovers the source dimensions and uses the same cancellable,
atomic FFmpeg composition service as the video editor. It never replaces an
existing destination or the source video.

Create an editable Bolas image workspace from a local image with:

```sh
gjs -m examples/create-image-workspace.js \
  /absolute/path/to/screenshot.png
```

The example embeds an oriented PNG source, empty image and canvas documents, and
the default Aurora composition using the same validated, atomic workspace service
as the editor. It creates a collision-free project inside Bolas's private workspace
library, where the application shows it under Recents.
