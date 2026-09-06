# Unified image-composition performance

The image workspace keeps full-resolution rendering separate from its live
preview. Export and app handoff render from the original oriented pixbuf
plus the live image and canvas documents. The interactive preview scales only
sources whose longest edge exceeds 1600 pixels and caches the composed Cairo
surface until an edit, allocation, or share setting changes.

Presentation canvases are contain-fitted without a reserved stage inset, so
one canvas dimension always reaches the corresponding preview edge. An inset
is applied only when explicitly requested for ordinary image inspection.

Adding a background does not flatten editor annotations. The bounded image
preview is rendered to a Cairo surface, fitted by the shared background painter,
then transformed and annotated by the canvas document. Full-resolution export
repeats the same pipeline from the original pixbuf. Pointer mapping performs the
inverse canvas transform in memory; it does not create an intermediate image.

The background chooser begins with a procedural checkerboard None swatch, then
uses 192 × 84 bundled swatches from
`src/share/backgrounds/swatches/`. These are center-cropped versions of the
1600 × 900 canvas artwork and are installed beside the full assets. Controls
must never decode full canvas backgrounds solely to draw chooser tiles. The
chooser uses a homogeneous GTK flow layout that adds columns as its container
widens and never drops below three columns. Selecting None keeps the panel open,
disables the presentation canvas, and preserves it for later re-enablement.

Still images now enter the unified workspace directly through the main window's
native navigation push. There is no second composer entrance or duplicate live
preview to allocate.

Workspace Save reuses the bounded live composition surface to produce a private
Recents thumbnail no larger than 640 × 400. Home queries its metadata
asynchronously, decodes only that small PNG per visible grid cell, and never opens
the full compressed workspace for card rendering. Unbinding a recycled cell
cancels its metadata request.

Tests cover preview-source bounds, every swatch asset, full composition export,
and reversible layer mapping through crop, rotation, and flip. When changing
this path, also verify entry with an opaque 4K source because opaque-alpha
inspection and Cairo scaling are the most expensive case.
