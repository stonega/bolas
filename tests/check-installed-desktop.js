import Gio from 'gi://Gio?version=2.0';
import GioUnix from 'gi://GioUnix?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { APP_ID, APP_NAME } from '../src/config.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const root = GLib.getenv('BOLAS_PACKAGE_ROOT');
  assert(root, 'Run this check through tests/test-packages.sh with an isolated package root');
  const id = `${APP_ID}.desktop`;
  const expectedPath = GLib.build_filenamev([root, 'usr', 'share', 'applications', id]);
  const app = GioUnix.DesktopAppInfo.new(id);

  assert(app, 'GIO must discover the packaged launcher by application ID');
  assert(app.get_filename() === expectedPath, 'The launcher must come from the extracted package');
  assert(app.get_name() === APP_NAME, 'The application list must show the Bolas name');
  assert(app.should_show(), 'The packaged launcher must be visible in the GNOME application list');
  assert(!app.get_is_hidden(), 'The packaged launcher must not be hidden');
  assert(app.get_executable() === 'bolas', 'The desktop entry must use the installed launcher');
  assert(app.get_icon()?.to_string() === APP_ID, 'The desktop entry must name the bundled icon');
  assert(
    Gio.AppInfo.get_all().some((candidate) => candidate.get_id() === id && candidate.should_show()),
    'The packaged launcher must appear when GIO enumerates visible applications',
  );

  print(`GIO discovers a visible Bolas launcher in ${root}`);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}
