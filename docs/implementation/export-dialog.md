# Image and video export

`presentExportDialog()` in `src/window.js` owns the shared `Adw.Dialog`, format
row, native destination chooser, status label, progress bar, and Cancel/Done
controls. `model/export.js` defines PNG/JPEG and WebM/MP4, their MIME types and
extensions, and timestamp progress parsing. A mismatched known extension is
replaced when the user chooses another format. Non-local chooser results are
rejected explicitly.

The modal's primary action is labeled Export. Its action row gives Cancel and
Export/Done buttons a minimum height of 44 logical pixels. Progress status appears below the
bar with the native caption and dim-label styles for smaller, muted gray text.
Errors retain the error style for visibility.

One cancellable covers the chooser and export. Format and Export controls are
disabled while it is active, so repeated clicks cannot launch concurrent jobs.
Closing the active dialog requests cancellation and waits for cleanup; disposing
the workspace cancels the job, stops progress animation, and suppresses late UI
updates. Errors stay in the dialog with controls re-enabled for retry. Export
does not change the project's saved fingerprint.

`services/export-process.js` starts children without a shell, drains stdout
incrementally, retains only a bounded stderr tail, and waits for process exit
after cancellation before permitting staging cleanup. Video encoding reads
FFmpeg `-progress pipe:1` records. `out_time_us` is divided by the selected
duration after speed adjustment, kept monotonic, and capped at 99% until the
container is finished and moved into place.

MP4 uses x264 when present and OpenH264 otherwise, with AAC audio and fast-start
container metadata. Encoder discovery is asynchronous. x264 uses CRF 23;
OpenH264 uses 8 Mbit/s. WebM keeps the existing VP9 CRF 32 and Opus settings.
Missing encoders produce an actionable error instead of silently changing format.

Image export asynchronously encodes the immutable oriented source pixbuf into a
private staging directory beside the destination. A JSON snapshot contains the
image document, canvas document, composition options, and format. A separate GJS
worker reconstructs both documents and invokes the existing full-resolution
renderer. PNG retains alpha; JPEG composites onto white and uses quality 95.
Image progress pulses through actual preparation, rendering, encoding, and
finalization stages because the native image encoders do not expose percentages.

Only a completed, mode-0600 file is moved to the destination with
`Gio.FileCopyFlags.NONE`; an existing destination, including one created during
rendering, is refused. The source and unrelated files are never replaced. Worker
inputs and partial output are removed on success, failure, or cancellation.
The worker and new service/model modules are included in the Meson installation.

Run `bun run check` for deterministic and integration checks. The image test
compares output against the live renderer, exercises JPEG transparency,
cancellation, progress, main-loop responsiveness, and destination protection.
Video tests render both containers where H.264 encoding is available, inspect
codecs and audio, and verify edited duration and progress. On systems with only
Fedora's `noopenh264` placeholder, they verify MP4 failure and cleanup instead;
WebM tests always run. Native UI smoke checks remain separate from these tests.

Runnable service examples:

```sh
gjs -m examples/export-image.js input.png output.jpg jpeg
gjs -m examples/edit-video.js input.webm output.mp4 0 3 --mp4
```
