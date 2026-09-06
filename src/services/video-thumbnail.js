import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { APP_ID } from '../config.js';

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_THUMBNAIL_TIMESTAMP_US = 250_000;
const MAX_CACHE_ENTRIES = 256;
const WORKSPACE_COVER_END_GUARD_US = 100_000;

function cancellationError() {
  const error = new Error('Video thumbnail generation was cancelled.');
  error.cancelled = true;
  return error;
}

export function isVideoThumbnailCancellation(error) {
  return Boolean(error?.cancelled);
}

export function videoThumbnailCacheDirectory(
  cacheDirectory = GLib.get_user_cache_dir(),
  appId = APP_ID,
) {
  return GLib.build_filenamev([cacheDirectory, appId, 'video-thumbnails']);
}

export function videoThumbnailCachePath(
  sourcePath,
  {
    appId = APP_ID,
    cacheDirectory = GLib.get_user_cache_dir(),
    fileSize = 0,
    modifiedTime = 0,
    timestampUs = DEFAULT_THUMBNAIL_TIMESTAMP_US,
  } = {},
) {
  const canonicalPath = GLib.canonicalize_filename(String(sourcePath ?? ''), null);
  const identity = JSON.stringify([
    canonicalPath,
    Number(fileSize),
    Number(modifiedTime),
    thumbnailTimestampUs(timestampUs),
  ]);
  const digest = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, identity, -1);
  return GLib.build_filenamev([
    videoThumbnailCacheDirectory(cacheDirectory, appId),
    `${digest}.png`,
  ]);
}

function nonnegativeMicroseconds(value, fallback = 0) {
  const timestamp = Math.round(Number(value));
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : fallback;
}

function thumbnailTimestampUs(value) {
  return nonnegativeMicroseconds(value, DEFAULT_THUMBNAIL_TIMESTAMP_US);
}

function secondsArgument(microseconds) {
  return (thumbnailTimestampUs(microseconds) / 1_000_000).toFixed(6);
}

export function videoWorkspaceCoverTimestampUs({
  durationUs = 0,
  timestampUs = 0,
  trimEndUs = durationUs,
  trimStartUs = 0,
} = {}) {
  const duration = nonnegativeMicroseconds(durationUs);
  const start = Math.min(duration, nonnegativeMicroseconds(trimStartUs));
  const end = Math.min(duration, Math.max(start, nonnegativeMicroseconds(trimEndUs, duration)));
  if (end <= start) return start;

  // Seeking to the exact end of a stream may not yield a decodable frame. Keep
  // the cover close to the saved playhead while leaving a small frame-safe tail.
  const endGuard = Math.min(
    WORKSPACE_COVER_END_GUARD_US,
    Math.max(1, Math.floor((end - start) / 2)),
  );
  const latest = end - endGuard;
  return Math.min(latest, Math.max(start, nonnegativeMicroseconds(timestampUs, start)));
}

export function buildVideoThumbnailArguments(
  sourcePath,
  outputPath,
  ffmpegPath = 'ffmpeg',
  { timestampUs = DEFAULT_THUMBNAIL_TIMESTAMP_US } = {},
) {
  return [
    ffmpegPath,
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-threads',
    '1',
    '-ss',
    secondsArgument(timestampUs),
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    'scale=640:360:force_original_aspect_ratio=decrease',
    '-an',
    '-sn',
    '-dn',
    '-map_metadata',
    '-1',
    '-f',
    'image2',
    '-vcodec',
    'png',
    '-threads',
    '1',
    '-n',
    outputPath,
  ];
}

function runThumbnailProcess(args, cancellable) {
  if (cancellable?.is_cancelled()) return Promise.reject(cancellationError());

  let process;
  try {
    process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDERR_PIPE);
  } catch (_error) {
    return Promise.reject(new Error('FFmpeg is unavailable for video previews.'));
  }

  return new Promise((resolve, reject) => {
    const cancellationSignalId =
      cancellable?.connect(() => {
        try {
          process.force_exit();
        } catch (_error) {
          // The process may already have exited between cancellation and this callback.
        }
      }) ?? 0;

    process.communicate_utf8_async(null, null, (subprocess, result) => {
      if (cancellationSignalId) cancellable.disconnect(cancellationSignalId);
      try {
        subprocess.communicate_utf8_finish(result);
        if (cancellable?.is_cancelled()) throw cancellationError();
        if (!subprocess.get_successful())
          throw new Error('FFmpeg could not decode a preview frame for this recording.');
        resolve(true);
      } catch (error) {
        reject(cancellable?.is_cancelled() ? cancellationError() : error);
      }
    });
  });
}

function sourceMetadata(source, modifiedTime, fileSize, cancellable) {
  if (modifiedTime !== null && fileSize !== null) return { fileSize, modifiedTime };

  const info = source.query_info(
    `${Gio.FILE_ATTRIBUTE_STANDARD_SIZE},${Gio.FILE_ATTRIBUTE_TIME_MODIFIED}`,
    Gio.FileQueryInfoFlags.NONE,
    cancellable,
  );
  return {
    fileSize: fileSize ?? Number(info.get_size()),
    modifiedTime:
      modifiedTime ?? Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
  };
}

function pruneThumbnailCache(directoryPath, keepPath, maxEntries = MAX_CACHE_ENTRIES) {
  let enumerator;
  try {
    const directory = Gio.File.new_for_path(directoryPath);
    enumerator = directory.enumerate_children(
      `${Gio.FILE_ATTRIBUTE_STANDARD_NAME},${Gio.FILE_ATTRIBUTE_STANDARD_TYPE},${Gio.FILE_ATTRIBUTE_TIME_MODIFIED}`,
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    const entries = [];
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
      const name = info.get_name();
      if (info.get_file_type() !== Gio.FileType.REGULAR || !name.endsWith('.png')) continue;
      entries.push({
        modifiedTime: Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
        path: GLib.build_filenamev([directoryPath, name]),
      });
    }
    entries.sort((left, right) => right.modifiedTime - left.modifiedTime);
    for (const entry of entries.slice(maxEntries)) {
      if (entry.path !== keepPath) Gio.File.new_for_path(entry.path).delete(null);
    }
  } catch (_error) {
    // Cache pruning is best effort and must not hide an otherwise valid preview.
  } finally {
    try {
      enumerator?.close(null);
    } catch (_error) {
      // The enumerator may already be closed after a failed read.
    }
  }
}

export async function generateVideoThumbnail({
  appId = APP_ID,
  cacheDirectory = GLib.get_user_cache_dir(),
  cancellable = null,
  ffmpegPath = 'ffmpeg',
  fileSize = null,
  modifiedTime = null,
  sourcePath,
  timestampUs = DEFAULT_THUMBNAIL_TIMESTAMP_US,
}) {
  const inputPath = String(sourcePath ?? '');
  if (!inputPath || !GLib.path_is_absolute(inputPath))
    throw new Error('Choose a local recording for its preview.');
  if (cancellable?.is_cancelled()) throw cancellationError();

  const source = Gio.File.new_for_path(inputPath);
  if (!source.query_exists(cancellable)) throw new Error('The recording is no longer available.');
  const metadata = sourceMetadata(source, modifiedTime, fileSize, cancellable);
  const outputPath = videoThumbnailCachePath(inputPath, {
    appId,
    cacheDirectory,
    ...metadata,
    timestampUs,
  });
  const output = Gio.File.new_for_path(outputPath);
  if (output.query_exists(cancellable)) return outputPath;

  const directory = GLib.path_get_dirname(outputPath);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the private video preview cache.');
  if (GLib.chmod(directory, 0o700) !== 0)
    throw new Error('Could not secure the private video preview cache.');

  const temporaryPath = GLib.build_filenamev([directory, `.${GLib.uuid_string_random()}.tmp.png`]);
  try {
    await runThumbnailProcess(
      buildVideoThumbnailArguments(inputPath, temporaryPath, ffmpegPath, { timestampUs }),
      cancellable,
    );
    if (GLib.chmod(temporaryPath, 0o600) !== 0)
      throw new Error('Could not secure the video preview.');
    try {
      Gio.File.new_for_path(temporaryPath).move(output, Gio.FileCopyFlags.NONE, null, null);
    } catch (error) {
      if (!error.matches?.(Gio.io_error_quark(), Gio.IOErrorEnum.EXISTS)) throw error;
    }
    pruneThumbnailCache(directory, outputPath);
    return outputPath;
  } finally {
    if (GLib.file_test(temporaryPath, GLib.FileTest.EXISTS)) GLib.unlink(temporaryPath);
  }
}

export class VideoThumbnailQueue {
  constructor({ maxConcurrent = DEFAULT_MAX_CONCURRENT, runJob = generateVideoThumbnail } = {}) {
    this._active = 0;
    this._maxConcurrent = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
    this._pending = [];
    this._runJob = runJob;
  }

  request(options) {
    const cancellable = options?.cancellable ?? null;
    if (cancellable?.is_cancelled()) return Promise.reject(cancellationError());

    return new Promise((resolve, reject) => {
      const job = {
        cancellable,
        cancellationSignalId: 0,
        options,
        reject,
        resolve,
        settled: false,
        started: false,
      };
      job.cancellationSignalId =
        cancellable?.connect(() => {
          job.cancellationSignalId = 0;
          if (job.started || job.settled) return;
          const index = this._pending.indexOf(job);
          if (index >= 0) this._pending.splice(index, 1);
          job.settled = true;
          reject(cancellationError());
        }) ?? 0;
      this._pending.push(job);
      this._drain();
    });
  }

  _drain() {
    while (this._active < this._maxConcurrent && this._pending.length > 0) {
      const job = this._pending.shift();
      if (job.settled) continue;
      job.started = true;
      this._active++;
      Promise.resolve(this._runJob(job.options))
        .then((path) => this._settle(job, job.resolve, path))
        .catch((error) => this._settle(job, job.reject, error))
        .finally(() => {
          this._active--;
          this._drain();
        });
    }
  }

  _settle(job, callback, value) {
    if (job.settled) return;
    job.settled = true;
    if (job.cancellationSignalId) job.cancellable.disconnect(job.cancellationSignalId);
    job.cancellationSignalId = 0;
    callback(value);
  }
}
