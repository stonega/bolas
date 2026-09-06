import GLib from 'gi://GLib?version=2.0';

import { captureScreenshot } from '../src/services/screenshot-capture.js';

const loop = new GLib.MainLoop(null, false);
captureScreenshot()
  .then((path) => print(path ?? 'Screenshot cancelled.'))
  .catch((error) => printerr(error.message))
  .finally(() => loop.quit());
loop.run();
