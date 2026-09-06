# Development launcher hides the installed application

## What happened

After installing the v0.1.0 RPM, Bolas did not appear in the GNOME application
grid. The package contained a valid desktop entry, executable launcher, and icon.

## Impact

A profile used with an earlier development setup could not discover the
installed application in the grid. Clean profiles were unaffected.

## Root cause

An obsolete user-local `io.github.stonega.Bolas.desktop` took precedence over
the RPM's system desktop entry. That development entry used `Exec=gjs`,
`OnlyShowIn=X-BolasDevelopment;`, and `X-Bolas-Development=true`. GIO resolved
the user file and returned `should_show() == false` in GNOME. Loading the
packaged desktop entry directly returned `should_show() == true`.

## Fix

The obsolete entry was moved to a sibling `.bolas-development-backup` file.
GIO then resolved `/usr/share/applications/io.github.stonega.Bolas.desktop`
and included Bolas in its visible application list. No package file or GNOME
Shell setting needed changing.

Version 0.1.1 documents this recovery procedure. It does not remove or alter
user-local desktop entries automatically; affected profiles must back up the
obsolete development override once.

## Prevention and follow-up

- Package verification now uses GIO to discover the launcher by application ID,
  check its visibility in GNOME, and verify its executable and icon.
- Checks run for both extracted package formats with isolated XDG data and
  configuration directories, without a live desktop session.
- Keep development identity entries out of the persistent user applications
  directory. The current source runner creates no desktop entry there.
- Troubleshooting must check the resolved desktop entry path as well as the
  system package's metadata and icon files.
