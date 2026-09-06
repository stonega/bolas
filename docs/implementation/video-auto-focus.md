# Video input auto focus

## Behavior

The video editor analyzes the current selected range once after media metadata
becomes available. The **Auto Focus** action repeats analysis after the user
changes the trim. A positive detection creates a Zoom-lane block with:

- the weighted center of the changing input content as its focus point;
- a content-derived scale clamped to 1.25×–2.2×;
- 250 ms of lead-in and 800 ms of hold after the final visible change;
- a confidence value and `input` source marker; and
- a cosine-eased transition capped at 250 ms on each edge.

Editing a generated block changes its source marker to `user`. A later scan
therefore replaces only unmodified generated blocks and preserves deliberate
timeline work. Whole-frame scene changes, scrolling, and regions taller than a
typical text field are rejected. The detector is intentionally conservative:
the absence of a block is preferable to a distracting zoom.

## Analysis pipeline

`services/video-auto-focus.js` owns file and process integration. It invokes
FFmpeg without a shell, limits decoding to one thread, removes audio, subtitles,
data, and metadata, and samples the trimmed interval into grayscale PGM frames.
The sample width is 320 pixels. The sample rate is at most 4 Hz and adapts so a
scan produces no more than 480 frames.

Frames are written into a mode-0700 temporary directory. One frame pair is read
and compared per GLib idle iteration, preventing a long scan from monopolizing
the GTK main loop. Cancellation terminates FFmpeg, stops comparison, and uses the
same cleanup path as success or failure.

`video/auto-focus.js` contains deterministic, filesystem-independent geometry:

1. pixels with a luminance difference below 20 are ignored;
2. whole-frame changes above 18% are rejected;
3. nearby changed cells are grouped into components;
4. components are grouped over time by position and sub-second gaps;
5. at least three observations over 300 ms are required; and
6. accepted activity is converted into normalized focus and scale values.

Detection coordinates are relative to the imported recording. Generated blocks
retain that source point directly; ratio and padding changes only reposition the
recording and never remap its focus. Editing a generated block converts it to a
user-authored source-video point.

No frame, source path, or detection output leaves the device. The generated PGM
files are removed when analysis finishes and are not retained as cache.

## Preview and export

`videoZoomAt()` and `videoSourceTransformAt()` are the preview sources of truth
for active focus, scale, and edge easing. The GTK preview transforms only the
effect-aware picture inside the rounded recording viewport. Active blur regions
are clipped and blurred while that picture snapshots; the background, shadow,
and caption remain in the untransformed composed canvas. The managed
`GtkMediaFile` is presented directly through a shrinkable, contain-fitted
`GtkPicture`, which preserves the recording's intrinsic aspect ratio. Avoid
`GtkVideo` here: its internal player surface provides a black letterbox which can
obscure the composed background around the recording. The preview applies the
shared padding as symmetric overlay margins, making the fitted recording's GTK
allocation match the share-renderer layout.

`services/video-export.js` applies masks and FFmpeg `zoompan` expressions to the
source-video stream first. It then scales and clips the effected recording into
the share canvas and adds captions after composition. Both preview and export
begin and end at 1×, reach the requested scale after the ease-in, and use the
normalized source-video focus point while the block is active.

## Failure model

Unsupported or undecodable video produces a recoverable editor error. A rescan
with no confident typing activity removes prior unedited generated blocks while
leaving user-created or edited blocks unchanged. Cancellation is silent. Manual
zoom editing and export remain available when automatic detection cannot
identify an input field.
