# Video editor interaction performance

The video workspace keeps pointer input, media decoding, and GTK presentation
updates on separate schedules. Timeline drag signals retain only their newest
seek, trim, or timed-block resize request and apply it from a widget frame-clock callback. Media
timestamp, playing, and seeking notifications use a second latest-value
coalescer. Neither path may issue more than one presentation update per display
frame.

A timestamp-only update changes the timeline playhead, time label, active
caption, active blur regions, and imported-video transform. During playback a
continuous GTK frame-clock callback drives these values. The `GtkMediaFile`
paintable invalidates itself when a decoded frame is ready, so the playback tick
must not also call `queue_draw()` on the video picture. `GtkMediaStream` backends
may report timestamps much less often than the display refresh rate, so
`PlaybackClock` advances from the latest report with monotonic frame time and
reconciles forward when a newer backend timestamp arrives. Pause and seek states
still use the exact media or requested timestamp.
The update does not normalize
the complete timeline model, synchronize unrelated controls, reset widget
allocations, or repaint the background. Full preview layout and Cairo backdrop
painting occur only when source geometry or share-canvas settings change.
The composed canvas is contain-fitted against the complete preview allocation
without an additional outer inset; presentation padding applies only between
the canvas edge and the imported recording.
Recording transforms and blur regions are keyed so unchanged effect state does
not replace the GSK transform or invalidate the video render node.

Direct blur-region drag updates use their own latest-value frame coalescer.
Pointer motion is converted from preview pixels to normalized source-video
coordinates immediately, but edit normalization, timeline repainting, and the
effect-aware picture update run at most once per display frame. Releasing the
pointer flushes the final geometry so no last movement is lost.

Trim dragging combines edit normalization and seeking into one synchronization
pass. `GtkMediaStream` seeks may finish asynchronously, so the requested target
remains the visible playhead while GTK reports an active seek. A later media
notification reconciles the preview with the stream timestamp.

Timed-block edge dragging uses the same latest-value coalescer. Each presented
resize normalizes the affected segment once, redraws the timeline, and refreshes
only the active caption, blur, or zoom preview state. Resizing a generated
input-focus block makes it a user-owned edit so a later automatic-focus scan
cannot replace the deliberate range.

Automatic input-focus analysis reads each sampled PGM frame through
`Gio.File.load_contents_async()`. Pixel comparison remains deliberately bounded
to one 320-pixel-wide frame pair after each asynchronous read, preventing the
analysis queue from performing synchronous disk I/O in a repeating GTK idle
callback. FFmpeg remains limited to one decoding thread and 480 frames.

`LatestFrameCoalescer` and `PlaybackClock` are independent of GTK so deterministic
tests can verify that rapid updates schedule one frame, the newest value wins,
and playback advances at display-frame cadence even when backend timestamp
notifications are sparse. Integration tests continue to cover automatic-focus
detection and cancellation.

Back navigation first cancels export, automatic-focus analysis, workspace I/O,
queued interaction updates, and playback. The video workspace then uses a
non-animated programmatic navigation pop. Animating its live media paintable,
nested preview transforms, and Cairo-rendered backdrop as one outgoing surface
creates a large synchronous compositing cost on the GTK main loop. Image
workspace navigation remains animated, and video resources are still released
when the outgoing page reports that it is hidden.
