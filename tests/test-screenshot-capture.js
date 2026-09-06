import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import {
  managedScreenshotDirectory,
  managedScreenshotPath,
  persistScreenshot,
  screenshotRequestPath,
  screenshotUriFromResponse,
} from '../src/services/screenshot-capture.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-screenshot-capture-${GLib.uuid_string_random()}`,
]);
const sourcePath = GLib.build_filenamev([root, 'portal-output.png']);
let capturedPath = null;

try {
  assert(
    screenshotRequestPath(':1.42', 'bolas_token') ===
      '/org/freedesktop/portal/desktop/request/1_42/bolas_token',
    'portal request path was not normalized',
  );
  assert(
    screenshotUriFromResponse(0, { uri: 'file:///tmp/screenshot.png' }) ===
      'file:///tmp/screenshot.png',
    'successful portal response did not return its URI',
  );
  assert(screenshotUriFromResponse(1) === null, 'portal cancellation must not be an error');
  let denied = false;
  try {
    screenshotUriFromResponse(2);
  } catch {
    denied = true;
  }
  assert(denied, 'portal denial must be reported');

  const directory = managedScreenshotDirectory(root, 'io.test.Bolas');
  assert(
    directory === GLib.build_filenamev([root, 'io.test.Bolas', 'captured-screenshots']),
    'managed screenshot directory is incorrect',
  );
  assert(
    managedScreenshotPath(root, 'io.test.Bolas', 'known-id') ===
      GLib.build_filenamev([directory, 'screenshot-known-id.png']),
    'managed screenshot path is incorrect',
  );

  GLib.mkdir_with_parents(root, 0o700);
  GLib.file_set_contents(sourcePath, 'captured pixels');
  const loop = new GLib.MainLoop(null, false);
  let copyError = null;
  persistScreenshot(Gio.File.new_for_path(sourcePath).get_uri(), {
    appId: 'io.test.Bolas',
    cacheDirectory: root,
  })
    .then((path) => {
      capturedPath = path;
    })
    .catch((error) => {
      copyError = error;
    })
    .finally(() => loop.quit());
  loop.run();
  if (copyError) throw copyError;
  assert(
    capturedPath?.startsWith(`${directory}/`),
    'captured screenshot escaped its private directory',
  );
  const [, capturedContents] = GLib.file_get_contents(capturedPath);
  assert(
    new TextDecoder().decode(capturedContents) === 'captured pixels',
    'captured screenshot contents changed during persistence',
  );
  const fileInfo = Gio.File.new_for_path(capturedPath).query_info(
    Gio.FILE_ATTRIBUTE_UNIX_MODE,
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  assert(
    (fileInfo.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE) & 0o777) === 0o600,
    'captured screenshot must be private',
  );

  Gio.File.new_for_path(capturedPath).delete(null);
  Gio.File.new_for_path(sourcePath).delete(null);
  Gio.File.new_for_path(directory).delete(null);
  Gio.File.new_for_path(GLib.path_get_dirname(directory)).delete(null);
  Gio.File.new_for_path(root).delete(null);
  print('screenshot capture rules are valid');
  System.exit(0);
} catch (error) {
  if (capturedPath && GLib.file_test(capturedPath, GLib.FileTest.EXISTS)) GLib.unlink(capturedPath);
  if (GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) GLib.unlink(sourcePath);
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}
