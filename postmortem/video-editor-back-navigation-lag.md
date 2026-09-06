# Video editor Back navigation lag

## What happened

Returning from the video editor to Home could stall for more than a second,
especially while video playback was active. Back could also appear ineffective
during the automatic-focus scan because the editor rejected navigation while it
was busy.

## Impact

The most common exit path from the video editor felt unresponsive. In local
profiling, an active video preview made the Back transition take about 1.7
seconds and occasionally longer than 2 seconds, while the same navigation with
the preview hidden completed in about 0.29 seconds.

## Root cause

The native libadwaita pop transition transformed the complete outgoing video
page. That page contains a live `GtkMediaFile` paintable, nested preview
transforms, and a Cairo-rendered share backdrop. GTK therefore offscreened and
recomposited an expensive subtree on the main loop throughout the animation.

The playback frame-clock callback also called `queue_draw()` on the video
picture every display frame even though the media paintable already invalidates
itself when decoded frames arrive. This added avoidable rendering pressure.

Separately, `requestBack()` returned early whenever an analysis, save, export,
or workspace operation set the editor's busy state. The initial automatic-focus
scan uses that state, so Back did not navigate during first load.

## Fix

Video Back now cancels active operations, queued interaction work, and playback,
then performs a non-animated programmatic pop to Home. Image navigation keeps
its native animation. The playback tick continues to update timeline and effect
state but no longer redundantly invalidates the media picture.

## Prevention and follow-up

- Source-level regression checks require video Back to use the non-animated
  host path and to remain available while work is active.
- Playback checks reject an unconditional video `queue_draw()` from the
  frame-clock callback.
- The manual video workflow now covers Back during playback and the initial
  automatic-focus scan.
- Keep expensive live-media compositions out of whole-page navigation
  transitions unless GTK profiling shows that the render path remains within a
  frame budget.
