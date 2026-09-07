# Bolas workspace format

## Purpose

`.bolas` is the editable media-project format. PNG and WebM export plus application
handoff remain flattened outputs. A workspace must reopen without the original
source path. Image projects retain every editable image/canvas element plus undo
and redo history; video projects retain the normalized timeline and share canvas.

The registered MIME type is
`application/vnd.io.github.stonega.bolas.workspace`.

## Container

Version 1 is one private file with this byte layout:

```text
offset  size  value
0       8     ASCII "BOLASWS" followed by NUL
8       ...   gzip stream containing UTF-8 JSON
```

The magic is checked before decompression. The compressed file is limited to
192 MiB, the expanded JSON to 256 MiB, and each decoded asset to 128 MiB. Loader
errors distinguish an invalid header, damaged gzip/JSON, checksum failure, unsafe
size, unsupported workspace kind, and a file created by a newer Bolas version.

## Manifest schema

The JSON root has an explicit `kind`. An image project has this canonical shape:

```json
{
  "schema": "io.github.stonega.Bolas.workspace",
  "version": 1,
  "kind": "image",
  "createdWith": "0.1.0",
  "source": {
    "displayName": "screenshot.png",
    "originalMimeType": "image/png",
    "width": 1920,
    "height": 1080,
    "asset": {
      "encoding": "base64",
      "mediaType": "image/png",
      "size": 1234,
      "sha256": "…",
      "data": "…"
    }
  },
  "documents": {
    "image": {},
    "canvas": {}
  },
  "composition": {
    "backgroundEnabled": true,
    "settings": {}
  },
  "session": {}
}
```

The source asset is always a PNG encoded from the oriented pixbuf that forms the
editor's visual source of truth. Animated and vector inputs therefore use the
static frame accepted by the user before editing or saving. Absolute source paths
are never written to the manifest.

`documents.image` is required. `documents.canvas` is required when a background
composition is enabled and otherwise may be null. Each document snapshot stores:

- snapshot version and capped history limit;
- original and current dimensions;
- current annotations, transforms, and selection;
- undo and redo arrays containing normalized document states.

Every annotation is re-normalized during load; persisted data never bypasses the
same type, geometry, color, opacity, font, and transform validation used for live
edits. Transactions are committed before serialization and are not stored.

Composition stores background enabled state, preset ID, ratio, padding, corner
radius, shadow enabled state, and shadow strength. Existing preset IDs and their
bundled artwork are immutable compatibility resources; visual replacements must
use a new preset ID.

Session state stores active layer, editor mode/sidebar, tool and style controls,
crop draft and ratio/orientation, selection-bearing document states, fit/zoom,
and pan. Session-only navigation changes do not drive the unsaved-change prompt.

A video project uses the same envelope and source-asset representation:

```json
{
  "schema": "io.github.stonega.Bolas.workspace",
  "version": 1,
  "kind": "video",
  "createdWith": "0.1.0",
  "source": {
    "displayName": "recording.webm",
    "originalMimeType": "video/webm",
    "width": 1920,
    "height": 1080,
    "durationUs": 8000000,
    "asset": {
      "encoding": "base64",
      "mediaType": "video/webm",
      "size": 1234,
      "sha256": "…",
      "data": "…"
    }
  },
  "edit": {},
  "session": { "timestampUs": 2250000 }
}
```

`edit` is the canonical output of `normalizeVideoEdit`: trim bounds, mute and
volume, speed, timed zoom/caption/mask segments, and share-canvas settings.
`session.timestampUs` restores the bounded playhead position. The embedded source
keeps its original container bytes and is limited to 128 MiB. On open it is
checksum-verified, written asynchronously to a private cache file, used by GTK
playback and FFmpeg, and removed when the workspace closes. Restored workspaces do
not rerun automatic input-focus analysis over already saved zoom segments.
Opening a video workspace enters the busy state without a loading toast; controls
remain disabled during loading, with cancellation and error reporting available.

## Save and recovery

The workspace library is
`$XDG_DATA_HOME/io.github.stonega.Bolas/workspaces`. Bolas creates it with
user-only permissions and monitors it for the home page's newest-first Recents
grid. A first Save derives a readable, collision-free project name from the source
and writes a uniquely named sibling temporary file before moving it into place.
No destination chooser is shown. Later Save operations require the etag read with
the managed workspace, request a backup, and atomically replace the current file.
An etag mismatch reports an external modification instead of discarding either
version. Cancellation or write failure leaves the previous project intact.

Both editors track a pending workspace save separately from other busy operations.
Preparing a video workspace for saving does not show a toast.
The existing Save button immediately reads Saving and stays disabled through
source preparation, the workspace write, and preview generation. Completion,
failure, or cancellation clears that state and restores Save. The video editor
hides its operation-cancel button while saving; workspace I/O still supports
cancellation through the existing keyboard and window lifecycle paths.

After a durable workspace write succeeds, Bolas writes a private PNG sidecar named
`<workspace>.preview.png`. Image projects render the complete saved composition.
Video projects extract the frame at the saved playhead, clamped inside the saved
trim with a small end guard so the requested position remains decodable. The
video frame is cached by source identity and timestamp before it is copied into
the workspace sidecar.

Each preview is bounded to 640 × 400, written through a uniquely named sibling
temporary file, atomically replaced, and restricted to mode `0600`. The
derivative is not part of the workspace schema and may be deleted without losing
edits. Recents accepts it only when its modification time is at least the
workspace modification time; missing, stale, corrupt, and legacy previews use the
fallback icon. A preview failure never invalidates an already successful
workspace Save.

Workspaces opened from Files, the command line, or the open dialog remain readable
from any local path. If that path is outside the managed library, Save creates a
new managed project and leaves the external file unchanged.

Only a successful workspace write advances the matching editor's saved
fingerprint. PNG/WebM Export and Share render the current edits but do not mark
them saved.

## Compatibility

The root workspace version and the document-snapshot version evolve independently.
Readers reject a larger root version with a clear newer-version error. When a
schema change becomes necessary, add a sequential, deterministic migration before
raising the media kind's workspace version; never reinterpret an existing field in place.
Unknown additive fields may be discarded when normalizing a version understood by
the reader.

Font family names and weights are stored with text annotations, but font binaries
are not embedded. A machine without the selected font may render the system
fallback while keeping the requested family in the editable annotation.
