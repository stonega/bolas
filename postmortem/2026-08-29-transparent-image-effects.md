# Transparent Image Effects Followed Canvas Bounds

**Date:** 2026-08-29  
**Status:** Resolved

## What happened

The share-image composer treated every source as an opaque rectangular
screenshot. When a PNG contained partially transparent pixels around its visible
content, Bolas clipped the full PNG canvas to synthetic rounded corners, drew a
shadow around those canvas bounds, and added a faint rectangular outline.

This was reproduced with `Screenshot From 2026-08-29 12-42-55.png`, whose soft
transparent edge and embedded shadow were valid source-image data. The decoder
and image-editor renderer preserved that alpha data exactly; the artifact was
introduced later by the share compositor.

## Impact

Transparent PNGs could show a large rounded rectangle or a second shadow around
their otherwise invisible canvas. Their original antialiased edge could also be
clipped. The live preview and exported share image used the same compositor, so
both displayed the defect.

Opaque screenshots were not affected.

## Root cause

The radius, shadow, and outline implementation used the source width and height
as the visual silhouette. That assumption is valid for an opaque screenshot but
not for an image whose visible content is defined by its alpha channel.

Checking only whether a pixbuf had an alpha channel would not have been enough:
some encoders retain a fully opaque alpha channel. Bolas did not inspect the
actual alpha samples before applying its rectangular presentation effects.

## Fix

The renderer now scans and caches the source pixbuf's alpha samples to distinguish
an opaque image from one containing non-opaque pixels.

For transparent sources, Bolas now:

- composites the original pixels directly over the selected background;
- preserves the source alpha silhouette and embedded shadow;
- skips synthetic corner clipping and rectangular shadow generation; and
- presents the Corner radius and Shadow controls as unavailable and off.

The synthetic hard outline was removed from share rendering. Opaque screenshots
continue to support Bolas's rounded corners and soft shadow.

Regression tests cover opaque alpha channels, partially transparent sources,
fully transparent sources, and the absence of rectangular shadow or outline
artifacts. The complete repository check passed with all nine tests.

## Prevention and follow-up

- Keep alpha-compositing coverage in the deterministic share-renderer tests.
- Include a soft-edge transparent PNG in manual preview and export checks.
- Treat pixel bounds and visible alpha bounds as different concepts in future
  rendering features.
- If radius or shadow controls are restored for transparent sources, implement
  them from the actual alpha silhouette rather than the rectangular canvas. An
  alpha-aware shadow must be deterministic and identical in preview and export
  before the controls are enabled.
