import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import {
  isSupportedImageName,
  isSupportedMediaName,
  isSupportedVideoName,
  screencastFolderPath,
  screenshotFolderPath,
} from '../src/model/screenshot-folder.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  assert(
    screenshotFolderPath('/tmp/Pictures') ===
      GLib.build_filenamev(['/tmp/Pictures', 'Screenshots']),
    'the screenshot folder must be below the Pictures directory',
  );
  assert(
    screencastFolderPath('/tmp/Videos') === GLib.build_filenamev(['/tmp/Videos', 'Screencasts']),
    'the screencast folder must be below the Videos directory',
  );
  assert(isSupportedImageName('Screenshot.png'), 'PNG screenshots must be listed');
  assert(isSupportedImageName('SCREENSHOT.JPEG'), 'image extensions must be case-insensitive');
  assert(isSupportedImageName('capture.webp'), 'WebP screenshots must be listed');
  assert(isSupportedVideoName('Recording.webm'), 'WebM recordings must be listed');
  assert(isSupportedVideoName('SCREENCAST.MP4'), 'video extensions must be case-insensitive');
  assert(isSupportedMediaName('recording.mkv'), 'supported videos must be media files');
  assert(!isSupportedImageName('.hidden'), 'extensionless files must not be listed');
  assert(!isSupportedVideoName('fake.mp4.txt'), 'only the final extension must be considered');
  assert(!isSupportedImageName('notes.txt'), 'non-image files must not be listed');

  print('screenshot folder rules are valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}
