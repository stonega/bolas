import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';
import System from 'system';

import {
  buildVideoThumbnailArguments,
  generateVideoThumbnail,
  isVideoThumbnailCancellation,
  VideoThumbnailQueue,
  videoThumbnailCachePath,
  videoWorkspaceCoverTimestampUs,
} from '../src/services/video-thumbnail.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function removeTree(file) {
  if (!file.query_exists(null)) return;
  const type = file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  if (type === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null))
      removeTree(file.get_child(info.get_name()));
    enumerator.close(null);
  }
  file.delete(null);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-video-thumbnail-${GLib.uuid_string_random()}`,
]);
const sourcePath = GLib.build_filenamev([root, 'source.webm']);
let exitCode = 0;

try {
  GLib.mkdir_with_parents(root, 0o700);
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
      'testsrc2=size=160x90:rate=15',
      '-t',
      '1',
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
  assert(generator.wait_check(null), 'could not create the video thumbnail fixture');

  const source = Gio.File.new_for_path(sourcePath);
  const info = source.query_info(
    `${Gio.FILE_ATTRIBUTE_STANDARD_SIZE},${Gio.FILE_ATTRIBUTE_TIME_MODIFIED}`,
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  const metadata = {
    fileSize: Number(info.get_size()),
    modifiedTime: Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
  };
  const firstCachePath = videoThumbnailCachePath(sourcePath, {
    appId: 'io.github.stonega.BolasThumbnailTest',
    cacheDirectory: root,
    ...metadata,
  });
  const changedCachePath = videoThumbnailCachePath(sourcePath, {
    appId: 'io.github.stonega.BolasThumbnailTest',
    cacheDirectory: root,
    ...metadata,
    modifiedTime: metadata.modifiedTime + 1,
  });
  const changedTimestampPath = videoThumbnailCachePath(sourcePath, {
    appId: 'io.github.stonega.BolasThumbnailTest',
    cacheDirectory: root,
    ...metadata,
    timestampUs: 500_000,
  });
  assert(firstCachePath !== changedCachePath, 'updated recordings must receive a new cache key');
  assert(
    firstCachePath !== changedTimestampPath,
    'different video cover positions must receive different cache keys',
  );

  const argumentsList = buildVideoThumbnailArguments(sourcePath, `${root}/preview.png`, 'ffmpeg', {
    timestampUs: 500_000,
  });
  assert(argumentsList.includes('-frames:v'), 'thumbnail extraction must stop after one frame');
  assert(argumentsList.includes('-threads'), 'thumbnail extraction must bound FFmpeg threads');
  assert(
    argumentsList.some((argument) => argument.includes('scale=640:360')),
    'thumbnail extraction must bound preview dimensions',
  );
  assert(
    argumentsList[argumentsList.indexOf('-ss') + 1] === '0.500000',
    'thumbnail extraction must seek to the requested cover position',
  );
  assert(
    videoWorkspaceCoverTimestampUs({
      durationUs: 1_200_000,
      timestampUs: 1_200_000,
      trimEndUs: 900_000,
      trimStartUs: 300_000,
    }) === 800_000,
    'workspace covers must remain inside the saved trim range',
  );
  assert(
    videoWorkspaceCoverTimestampUs({
      durationUs: 1_200_000,
      timestampUs: 100_000,
      trimEndUs: 900_000,
      trimStartUs: 300_000,
    }) === 300_000,
    'workspace covers must not precede the saved trim range',
  );

  const thumbnailPath = await generateVideoThumbnail({
    appId: 'io.github.stonega.BolasThumbnailTest',
    cacheDirectory: root,
    sourcePath,
    timestampUs: 500_000,
    ...metadata,
  });
  assert(thumbnailPath === changedTimestampPath, 'thumbnail path must include the cover position');
  const surface = Cairo.ImageSurface.createFromPNG(thumbnailPath);
  assert(surface.getWidth() === 640, 'video preview width is incorrect');
  assert(surface.getHeight() === 360, 'video preview height is incorrect');
  surface.finish();
  const thumbnailInfo = Gio.File.new_for_path(thumbnailPath).query_info(
    Gio.FILE_ATTRIBUTE_UNIX_MODE,
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  assert(
    (thumbnailInfo.get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE) & 0o777) === 0o600,
    'video previews must be private',
  );

  const cachedPath = await generateVideoThumbnail({
    appId: 'io.github.stonega.BolasThumbnailTest',
    cacheDirectory: root,
    ffmpegPath: 'ffmpeg-does-not-exist',
    sourcePath,
    timestampUs: 500_000,
    ...metadata,
  });
  assert(cachedPath === thumbnailPath, 'an existing thumbnail must be reused without FFmpeg');

  let releaseFirst;
  const started = [];
  const queue = new VideoThumbnailQueue({
    maxConcurrent: 1,
    runJob: ({ sourcePath: queuedPath }) => {
      started.push(queuedPath);
      return new Promise((resolve) => {
        releaseFirst = resolve;
      });
    },
  });
  const firstRequest = queue.request({ sourcePath: 'first' });
  const secondCancellable = new Gio.Cancellable();
  const secondResult = queue.request({ cancellable: secondCancellable, sourcePath: 'second' }).then(
    () => null,
    (error) => error,
  );
  secondCancellable.cancel();
  releaseFirst('first.png');
  assert((await firstRequest) === 'first.png', 'the active thumbnail request did not finish');
  assert(
    isVideoThumbnailCancellation(await secondResult),
    'a cancelled queued thumbnail did not report cancellation',
  );
  assert(started.join(',') === 'first', 'the cancelled queued thumbnail was still started');

  print('video thumbnail generation and queueing are valid');
} catch (error) {
  printerr(error.message);
  exitCode = 1;
} finally {
  try {
    removeTree(Gio.File.new_for_path(root));
  } catch (_error) {
    // The test result should report the original failure, not cleanup details.
  }
}

System.exit(exitCode);
