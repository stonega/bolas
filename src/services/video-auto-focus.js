import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import {
  autoFocusSampleRate,
  detectFrameInputActivity,
  inputFocusSegmentsFromActivities,
} from '../video/auto-focus.js';

const SAMPLE_WIDTH = 320;
const PGM_HEADER_DECODER = new TextDecoder();

function secondsArgument(microseconds) {
  return (Math.max(0, Number(microseconds) || 0) / 1_000_000).toFixed(6);
}

function cancellationError() {
  const error = new Error('Automatic input focus analysis was cancelled.');
  error.cancelled = true;
  return error;
}

export function isVideoAutoFocusCancellation(error) {
  return Boolean(error?.cancelled);
}

export function buildVideoAutoFocusArguments(
  sourcePath,
  outputPattern,
  { endUs, ffmpegPath = 'ffmpeg', startUs = 0 } = {},
) {
  const firstUs = Math.max(0, Number(startUs) || 0);
  const lastUs = Math.max(firstUs, Number(endUs) || 0);
  const durationUs = lastUs - firstUs;
  const sampleRate = autoFocusSampleRate(durationUs);
  return {
    args: [
      ffmpegPath,
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-threads',
      '1',
      '-ss',
      secondsArgument(firstUs),
      '-i',
      sourcePath,
      '-t',
      secondsArgument(durationUs),
      '-map',
      '0:v:0',
      '-frames:v',
      '480',
      '-vf',
      `fps=${sampleRate.toFixed(6)},scale=${SAMPLE_WIDTH}:-2:force_original_aspect_ratio=decrease,format=gray`,
      '-an',
      '-sn',
      '-dn',
      '-map_metadata',
      '-1',
      '-start_number',
      '0',
      '-f',
      'image2',
      '-vcodec',
      'pgm',
      '-n',
      outputPattern,
    ],
    sampleRate,
  };
}

function runFrameSampler(args, cancellable) {
  if (cancellable?.is_cancelled()) return Promise.reject(cancellationError());

  let process;
  try {
    process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDERR_PIPE);
  } catch (_error) {
    return Promise.reject(new Error('FFmpeg is unavailable for automatic input focus.'));
  }

  return new Promise((resolve, reject) => {
    const cancellationSignalId =
      cancellable?.connect(() => {
        try {
          process.force_exit();
        } catch (_error) {
          // The process may have exited between cancellation and this callback.
        }
      }) ?? 0;

    process.communicate_utf8_async(null, null, (subprocess, result) => {
      if (cancellationSignalId) cancellable.disconnect(cancellationSignalId);
      try {
        const [, , stderr] = subprocess.communicate_utf8_finish(result);
        if (cancellable?.is_cancelled()) throw cancellationError();
        if (!subprocess.get_successful()) {
          const detail = String(stderr ?? '')
            .trim()
            .split('\n')
            .slice(-3)
            .join(' ');
          throw new Error(
            detail
              ? `Could not analyze the video: ${detail}`
              : 'FFmpeg could not sample frames for automatic input focus.',
          );
        }
        resolve(true);
      } catch (error) {
        reject(cancellable?.is_cancelled() ? cancellationError() : error);
      }
    });
  });
}

function loadFrameBytes(path, cancellable) {
  const file = Gio.File.new_for_path(path);
  return new Promise((resolve, reject) => {
    file.load_contents_async(cancellable, (source, result) => {
      try {
        const [loaded, bytes] = source.load_contents_finish(result);
        if (!loaded) throw new Error('Could not read an automatic-focus analysis frame.');
        resolve(bytes);
      } catch (error) {
        reject(cancellable?.is_cancelled() ? cancellationError() : error);
      }
    });
  });
}

async function pgmFrame(path, timestampUs, cancellable) {
  const bytes = await loadFrameBytes(path, cancellable);
  let cursor = 0;
  const token = () => {
    while (cursor < bytes.length) {
      if (bytes[cursor] === 35) {
        while (cursor < bytes.length && bytes[cursor] !== 10) cursor++;
      } else if (bytes[cursor] <= 32) cursor++;
      else break;
    }
    const start = cursor;
    while (cursor < bytes.length && bytes[cursor] > 32) cursor++;
    return PGM_HEADER_DECODER.decode(bytes.subarray(start, cursor));
  };
  if (token() !== 'P5') throw new Error('FFmpeg returned an unsupported analysis frame.');
  const width = Number(token());
  const height = Number(token());
  const maximum = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || maximum !== 255)
    throw new Error('FFmpeg returned an invalid analysis frame.');
  if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) cursor += 2;
  else if (bytes[cursor] <= 32) cursor++;
  const data = bytes.subarray(cursor);
  if (data.length !== width * height)
    throw new Error('FFmpeg returned an incomplete analysis frame.');
  return { data, height, timestampUs, width };
}

function sampledFramePaths(directoryPath) {
  const directory = Gio.File.new_for_path(directoryPath);
  const enumerator = directory.enumerate_children(
    `${Gio.FILE_ATTRIBUTE_STANDARD_NAME},${Gio.FILE_ATTRIBUTE_STANDARD_TYPE}`,
    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
    null,
  );
  const paths = [];
  try {
    for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
      if (info.get_file_type() !== Gio.FileType.REGULAR || !info.get_name().endsWith('.pgm'))
        continue;
      paths.push(GLib.build_filenamev([directoryPath, info.get_name()]));
    }
  } finally {
    enumerator.close(null);
  }
  return paths.sort();
}

async function analyzeSampledFrames(paths, sampleRate, startUs, endUs, cancellable) {
  let previous = null;
  const observations = [];
  for (let index = 0; index < paths.length; index++) {
    if (cancellable?.is_cancelled()) throw cancellationError();
    const timestampUs = Math.min(endUs, startUs + Math.round((index / sampleRate) * 1_000_000));
    const current = await pgmFrame(paths[index], timestampUs, cancellable);
    if (previous) {
      observations.push({
        activity: detectFrameInputActivity(previous, current),
        endUs: current.timestampUs,
        startUs: previous.timestampUs,
      });
    }
    previous = current;
  }
  return inputFocusSegmentsFromActivities(observations, {
    trimEndUs: endUs,
    trimStartUs: startUs,
  });
}

function removeAnalysisDirectory(directoryPath) {
  if (!directoryPath || !GLib.file_test(directoryPath, GLib.FileTest.IS_DIR)) return;
  try {
    for (const path of sampledFramePaths(directoryPath)) Gio.File.new_for_path(path).delete(null);
    Gio.File.new_for_path(directoryPath).delete(null);
  } catch (_error) {
    // Cleanup is best effort and must not replace the analysis result or original error.
  }
}

export async function analyzeVideoInputFocus({
  cancellable = null,
  endUs,
  ffmpegPath = 'ffmpeg',
  sourcePath,
  startUs = 0,
}) {
  const inputPath = String(sourcePath ?? '');
  const firstUs = Math.max(0, Number(startUs) || 0);
  const lastUs = Math.max(firstUs, Number(endUs) || 0);
  if (!inputPath || !GLib.path_is_absolute(inputPath))
    throw new Error('Choose a local video for automatic input focus.');
  if (lastUs - firstUs < 400_000)
    throw new Error('Choose at least 0.4 seconds for automatic input focus.');
  if (cancellable?.is_cancelled()) throw cancellationError();
  if (!Gio.File.new_for_path(inputPath).query_exists(cancellable))
    throw new Error('The source video is no longer available.');

  const directoryPath = GLib.build_filenamev([
    GLib.get_tmp_dir(),
    `bolas-auto-focus-${GLib.uuid_string_random()}`,
  ]);
  if (GLib.mkdir_with_parents(directoryPath, 0o700) !== 0)
    throw new Error('Could not create the private automatic-focus workspace.');
  if (GLib.chmod(directoryPath, 0o700) !== 0) {
    removeAnalysisDirectory(directoryPath);
    throw new Error('Could not secure the automatic-focus workspace.');
  }

  const outputPattern = GLib.build_filenamev([directoryPath, '%06d.pgm']);
  const { args, sampleRate } = buildVideoAutoFocusArguments(inputPath, outputPattern, {
    endUs: lastUs,
    ffmpegPath,
    startUs: firstUs,
  });
  try {
    await runFrameSampler(args, cancellable);
    const paths = sampledFramePaths(directoryPath);
    if (paths.length < 2) return [];
    return await analyzeSampledFrames(paths, sampleRate, firstUs, lastUs, cancellable);
  } finally {
    removeAnalysisDirectory(directoryPath);
  }
}
