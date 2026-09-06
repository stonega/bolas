# Editing and sharing media

Still images open directly in one editing workspace with a presentation
background enabled. Draw, crop, rotate, export, background composition,
and application handoff all use the same canvas; creating a share image no
longer opens a second editor.

The presentation canvas uses the full available stage height by default. Draw
and every annotation always belong to the complete canvas while a background is
enabled, including annotations placed over the imported image. Draw opens only a
right-side panel and keeps the viewer header, canvas, and zoom toolbar in place.
It starts with Select active and the imported image outlined. The Select tool
chooses a canvas annotation first when one overlaps the image, then falls back to
the imported image itself. Choosing Pencil, Line, Arrow, a shape, or Text returns
the drawing target to the complete canvas. Crop is a separate peer panel that
always applies crop, rotate, and flip to the imported image. Clicking the imported
image opens that same Crop panel, while clicking the background opens composition
settings. Clicking an existing annotation opens the Draw panel with that annotation
selected. These shortcuts remain available while Crop is open and while Draw uses
Select. Image geometry remains independent from canvas annotations. Export and
Share always render the visible result.

Draw sits beside the zoom controls at the bottom of the canvas. Crop and Background
follow it and open their panels directly. Text starts in the system Sans font. When
Text is active or a text annotation is selected, the Draw panel shows a native font
chooser; a selected family applies immediately and becomes the default for new text.
Fit to Window frames the complete presentation canvas while a background is active.
Choose **None** at the start of the background list to edit without a presentation
canvas. Choosing any background restores the canvas and its existing annotations.

Ordinary image editing keeps a small inspection inset so transparent edges
remain easy to see.

Video editing previews the recording over the selected presentation background.
The area outside the rounded recording belongs to that background; Bolas does
not add a solid black player panel or letterbox around the video. The recording
keeps its original aspect ratio without cropping or stretching. Increasing
**Padding** reduces the recording inside the canvas and reveals more of the
selected background on every side. The settings panel keeps a stable width when
the window grows, leaving the extra space to the video preview. During playback,
the video, playhead, captions, and timed effects update at the display refresh
cadence even when the system media backend reports its timestamp infrequently.

Timed **Zoom** and **Blur** effects apply only inside the imported recording.
They do not magnify or soften the presentation background, shadow, or captions.
Their focus points and regions stay attached to the same video content when the
canvas ratio or padding changes.

Every visible timeline block can be selected. Drag its left or right edge to
change its duration; the pointer changes to a horizontal resize cursor over an
edge. Video, Audio, and the global Speed block share the selected clip
boundaries, so resizing any of those trims the linked clip. Zoom, Text, and Blur
blocks resize independently. With keyboard focus on the timeline, Up and Down
move the selection between blocks, Shift+Left or Shift+Right changes the
selected block's end, and Ctrl+Shift+Left or Ctrl+Shift+Right changes its start.

After adding a Blur effect, select its region on the video canvas and drag inside
it to change its position. Drag any visible edge or corner handle to change its
size. The region stays inside the recording and cannot shrink below its usable
minimum. With the region focused, the arrow keys move it in one-percent steps;
Shift+Left or Shift+Right shrinks or grows its right edge, and Shift+Up or
Shift+Down shrinks or grows its bottom edge. Double-clicking the Blur block on
the timeline still opens the numeric position, size, strength, and duration
controls.

Video projects use the same **Save** and Ctrl+S workflow as image projects. Their
portable `.bolas` workspace embeds the source recording plus normalized trim,
audio, speed, timed zoom, caption, blur-mask, share-canvas, and playhead state.
Opening the workspace restores those controls without rerunning automatic focus
analysis. The embedded recording is limited to 128 MiB; WebM Export and Share
remain available for larger sources. Export uses Ctrl+Shift+E and does not clear
the editable project's unsaved-change state.

Bolas remembers the annotation tool, color, line and text sizes, fill setting,
crop ratio, and crop orientation. It also restores the last background, canvas
ratio, padding, corner radius, and shadow setting. Each option is remembered as
soon as its control changes; exporting is not required. Background choices add
columns as the sidebar widens, with three columns as the minimum layout.

Images with transparent pixels keep their own edge. Bolas temporarily disables
the corner-radius and shadow controls for those images, but keeps your last
choices ready for the next opaque image.

For images, **Save** creates or updates an editable `.bolas` workspace containing the source,
both document layers, composition settings, session state, and undo/redo history.
Projects are named automatically, stored in Bolas's private library, and shown
newest-first under Recents on the home page. Saving also refreshes the card's
private composition preview. An external workspace is imported into that library
the first time it is saved. **Export…** lets you choose a durable flattened PNG
destination, and Share hands a temporary flattened image to another application.
Export and Share do not clear the workspace's unsaved-change state. No action
replaces the original image, external workspace, or unrelated output.

Image-layer annotations, canvas annotations, entered text, crop drafts, zoom,
selections, transformations, and undo/redo history belong to the current image
workspace and survive reopening its `.bolas` file. Starting another ordinary
image creates a separate workspace. Leaving any changed layer still requires
explicit discard confirmation even after exporting a PNG.
