# Share-image Composer Blocked the GTK Frame Loop

**Date:** 2026-08-30  
**Status:** Resolved

## What happened

Opening the share-image composer caused a long visible hitch, and the shared-image
entrance animation stuttered instead of moving smoothly. Interaction with the
composer could remain sluggish when adjusting controls for a large source image.

The composer performed several expensive operations on the GTK main thread while
its 260 ms preview fade, 420 ms sidebar reveal, and 460 ms shared-image transition
were beginning. The work consumed most or all of the transition duration, leaving
the frame loop unable to present animation frames on time.

## Impact

The first composer entry was especially slow because opening the settings sidebar
decoded all ten 1600 × 900 background assets to draw 96 × 42 chooser swatches.
Large opaque screenshots added a full alpha-channel scan and expensive Cairo
scaling. On a 4K source, repeated preview rendering also made live control changes
feel delayed.

Export correctness and source-image quality were not affected. The incident was a
responsiveness and motion-quality regression in the share-image workspace.

## Root cause

Four costs compounded on the GTK main thread:

- Each background chooser tile called the full canvas background renderer. The
  first sidebar draw synchronously decoded ten full-resolution PNG assets and took
  approximately 313 ms on the development machine.
- Composer construction synchronously decoded and oriented the source and scanned
  every alpha sample. The alpha scan alone took approximately 35 ms for a 4K opaque
  source.
- The live preview painted directly from the full-resolution source. A 4K preview
  repaint took approximately 94 ms, and settings changes invalidated the complete
  preview.
- The shared-image animation changed a `Gtk.Picture` widget's margins and size
  request on every frame. This forced repeated allocation and image scaling while
  the preview fade and sidebar reveal were running at the same time.

The deterministic tests covered share geometry and output pixels but did not
exercise first-entry asset decoding, frame-loop behavior, or a 4K native GTK
transition.

## Fix

Background controls now use ten bundled 192 × 84 swatch images. They preserve the
appearance of the full artwork while reducing first-load swatch rendering from
approximately 313 ms to 4.8 ms.

The composer now scales live-preview sources to a maximum 1600-pixel edge and
caches the composed, scale-aware Cairo surface until the allocation or settings
change. Full-resolution source pixels remain the source of truth for copy, export,
and app handoff. An unchanged cached preview draw measured approximately 0.21 ms.

Before the entrance animation clock starts, Bolas prepares the first composed
preview surface. The moving screenshot reuses the composer's preview pixbuf as a
`Gdk.Texture` and animates a texture-backed `Gtk.Picture` with `Gsk.Transform` and
opacity. Animation frames no longer decode the source, repaint it through Cairo,
or change widget allocation.

Regression coverage now verifies bounded preview dimensions, every bundled swatch,
and shared-image transition geometry and fade timing. A native 4K UI smoke test
exercised the complete entrance path successfully. The full repository check and
staged installation passed with all 14 tests.

Implementation details and invariants are recorded in
[`docs/implementation/share-image-performance.md`](../docs/implementation/share-image-performance.md).

## Prevention and follow-up

- Keep chooser artwork independent from full canvas assets; small controls must
  never decode export-resolution media.
- Preserve the boundary between bounded interactive previews and full-resolution
  output rendering.
- Prepare expensive immutable preview state before starting an animation clock.
- Animate texture transforms and opacity without changing widget measurement or
  allocation per frame.
- Retain the 4K native entrance smoke test when changing the composer, renderer,
  sidebar, or workspace transition.
- Benchmark first entry and steady-state control changes when adding backgrounds,
  effects, or new preview layers.
