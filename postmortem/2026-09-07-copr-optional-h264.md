# Initial COPR build and optional H.264 support

## What happened

COPR build 10956348 for Bolas 0.1.2 failed on all eight Fedora targets during
the MP4 export integration test. The source RPM and the other 26 tests passed.

## Impact

The initial COPR publication produced no installable packages. Existing user
files and previously installed packages were unaffected.

## Root cause

The test assumed every FFmpeg installation provided a working H.264 encoder.
Fedora build roots use `noopenh264`, which satisfies the library dependency and
appears in FFmpeg's encoder listing but cannot encode frames. Local Fedora
validation had the real OpenH264 library, and Debian CI had x264, so both passed.

## Fix

Version 0.1.3 probes H.264 with a synthetic frame in the integration test. Hosts
with a working encoder retain the complete MP4 round trip. Hosts without one
exercise the export error, absence of a published file, staging cleanup, and
destination protection. All WebM tests continue to run. The 0.1.2 tag remains
unchanged.

## Prevention

Keep testing both codec-equipped environments and minimal Fedora build roots.
Treat FFmpeg encoder listings as interface availability rather than proof that
an optional runtime codec works. Never disable the complete video-export suite
to accommodate an optional codec.
