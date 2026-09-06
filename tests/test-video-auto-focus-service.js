import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import {
  analyzeVideoInputFocus,
  isVideoAutoFocusCancellation,
} from '../src/services/video-auto-focus.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-auto-focus-test-${GLib.uuid_string_random()}`,
]);
const sourcePath = GLib.build_filenamev([root, 'typing.webm']);
let exitCode = 0;

try {
  GLib.mkdir_with_parents(root, 0o700);
  const boxes = Array.from(
    { length: 7 },
    (_, index) =>
      `drawbox=x=${54 + index * 13}:y=82:w=7:h=18:color=white:t=fill:enable='gte(t,${(
        0.25 + index * 0.25
      ).toFixed(2)})'`,
  );
  const generator = Gio.Subprocess.new(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-f',
      'lavfi',
      '-i',
      'color=c=#303030:size=320x180:rate=8:duration=3',
      '-vf',
      boxes.join(','),
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-an',
      '-f',
      'webm',
      '-n',
      sourcePath,
    ],
    Gio.SubprocessFlags.NONE,
  );
  assert(generator.wait_check(null), 'could not create the automatic-focus video fixture');

  const segments = await analyzeVideoInputFocus({
    endUs: 3_000_000,
    sourcePath,
    startUs: 0,
  });
  assert(segments.length === 1, 'sampled typing must create one automatic focus segment');
  assert(segments[0].source === 'input', 'sampled typing must retain its generated origin');
  assert(
    segments[0].focusX > 0.15 && segments[0].focusX < 0.55,
    'sampled typing focus must follow the synthetic input bar',
  );
  assert(
    segments[0].focusY > 0.35 && segments[0].focusY < 0.65,
    'sampled typing focus must follow the input bar vertically',
  );

  const cancelled = new Gio.Cancellable();
  cancelled.cancel();
  let cancellation = null;
  try {
    await analyzeVideoInputFocus({
      cancellable: cancelled,
      endUs: 3_000_000,
      sourcePath,
    });
  } catch (error) {
    cancellation = error;
  }
  assert(
    isVideoAutoFocusCancellation(cancellation),
    'a cancelled automatic-focus scan must report cancellation',
  );

  print('video automatic input focus service is valid');
} catch (error) {
  printerr(error.message);
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  if (GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) GLib.unlink(sourcePath);
  if (GLib.file_test(root, GLib.FileTest.IS_DIR)) GLib.rmdir(root);
}

System.exit(exitCode);
