import System from 'system';

import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MEDIA_FOLDER_SIDEBAR_MAX_WIDTH,
  MEDIA_FOLDER_SIDEBAR_MIN_WIDTH,
  MEDIA_FOLDER_SIDEBAR_WIDTH_FRACTION,
  MEDIA_FOLDER_THUMBNAIL_ASPECT_RATIO,
  PROJECT_URL,
  WORKSPACE_EXTENSION,
  WORKSPACE_MIME_TYPE,
} from '../src/config.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  assert(APP_ID === 'io.github.stonega.Bolas', 'the stable application ID changed unexpectedly');
  assert(APP_NAME === 'Bolas', 'the application name must remain Bolas');
  assert(/^\d+\.\d+\.\d+$/.test(APP_VERSION), 'the application version must use three-part SemVer');
  assert(DEFAULT_WINDOW_WIDTH >= 600, 'the default window must fit the primary content');
  assert(DEFAULT_WINDOW_HEIGHT >= 480, 'the default window must fit the primary content');
  assert(
    MEDIA_FOLDER_SIDEBAR_MIN_WIDTH >= 600,
    'the media folder sidebar must be at least twice its original 300 px width',
  );
  assert(
    MEDIA_FOLDER_SIDEBAR_MAX_WIDTH >= MEDIA_FOLDER_SIDEBAR_MIN_WIDTH,
    'the media folder sidebar maximum must include its minimum width',
  );
  assert(
    MEDIA_FOLDER_SIDEBAR_WIDTH_FRACTION >= 0.5 && MEDIA_FOLDER_SIDEBAR_WIDTH_FRACTION < 1,
    'the media folder sidebar must use most, but not all, of a wide window',
  );
  assert(
    Math.abs(MEDIA_FOLDER_THUMBNAIL_ASPECT_RATIO - 16 / 9) < Number.EPSILON,
    'media folder thumbnails must use a 16:9 aspect ratio',
  );
  assert(PROJECT_URL.startsWith('https://'), 'the project URL must use HTTPS');
  assert(WORKSPACE_EXTENSION === '.bolas', 'the workspace extension changed unexpectedly');
  assert(
    WORKSPACE_MIME_TYPE === 'application/vnd.io.github.stonega.bolas.workspace',
    'the workspace MIME type changed unexpectedly',
  );

  print('application configuration is valid');
  System.exit(0);
} catch (error) {
  printerr(error.message);
  System.exit(1);
}
