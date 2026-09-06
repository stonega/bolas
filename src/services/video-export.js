import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { APP_ID } from '../config.js';
import {
  renderShareVideoBackdrop,
  renderShareVideoMask,
  shareCanvasSize,
  shareImageLayout,
} from '../share/renderer.js';
import { normalizeVideoEdit, selectedVideoDurationUs } from '../video/edit.js';

function canonicalPath(path) {
  return GLib.canonicalize_filename(String(path ?? ''), null);
}

function secondsArgument(microseconds) {
  return (Number(microseconds) / 1_000_000).toFixed(6);
}

function cancellationError() {
  const error = new Error('Video export was cancelled.');
  error.cancelled = true;
  return error;
}

function evenSize(value) {
  return Math.max(2, Math.floor(Number(value) / 2) * 2);
}

function filterText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ');
}

function effectRange(segment, edit) {
  const startUs = Math.max(edit.trimStartUs, segment.startUs);
  const endUs = Math.min(edit.trimEndUs, segment.endUs);
  if (endUs <= startUs) return null;
  return {
    end: secondsArgument(endUs - edit.trimStartUs),
    endFrame: Math.max(0, Math.ceil(((endUs - edit.trimStartUs) / 1_000_000) * 30)),
    start: secondsArgument(startUs - edit.trimStartUs),
    startFrame: Math.max(0, Math.floor(((startUs - edit.trimStartUs) / 1_000_000) * 30)),
  };
}

function nestedZoomExpression(segments, valueFor, fallback) {
  let expression = fallback;
  for (let index = segments.length - 1; index >= 0; index--) {
    const { range, segment } = segments[index];
    expression = `if(between(on,${range.startFrame},${range.endFrame}),${valueFor(segment, range)},${expression})`;
  }
  return expression;
}

function animatedZoomExpression(segment, range) {
  const transitionFrames = Math.min(8, Math.floor((range.endFrame - range.startFrame) / 2));
  if (transitionFrames < 1) return segment.scale.toFixed(3);
  const eased = `if(lt(on,${range.startFrame + transitionFrames}),0.5-0.5*cos(PI*(on-${range.startFrame})/${transitionFrames}),if(gt(on,${range.endFrame - transitionFrames}),0.5-0.5*cos(PI*(${range.endFrame}-on)/${transitionFrames}),1))`;
  return `(1+${(segment.scale - 1).toFixed(3)}*${eased})`;
}

export function isVideoExportCancellation(error) {
  return Boolean(error?.cancelled);
}

export function buildVideoFilterGraph(edit, durationUs, options = {}) {
  const normalized = normalizeVideoEdit(edit, durationUs);
  const selectedSourceUs = normalized.trimEndUs - normalized.trimStartUs;
  if (selectedSourceUs <= 0) throw new Error('Choose a non-empty section of the video.');

  const sourceWidth = Math.round(Number(options.sourceWidth) || 0);
  const sourceHeight = Math.round(Number(options.sourceHeight) || 0);
  const needsDimensions =
    normalized.shareEnabled || normalized.zoomSegments.length > 0 || normalized.masks.length > 0;
  if (needsDimensions && (sourceWidth < 2 || sourceHeight < 2))
    throw new Error('The source video dimensions are unavailable.');

  const filters = [];
  let sequence = 0;
  let current = `video-${sequence}`;
  filters.push(
    `[0:v]trim=duration=${secondsArgument(selectedSourceUs)},setpts=PTS-STARTPTS[${current}]`,
  );

  let visualWidth = sourceWidth;
  let visualHeight = sourceHeight;

  for (const mask of normalized.masks) {
    const range = effectRange(mask, normalized);
    if (!range) continue;
    const x = Math.min(visualWidth - 2, Math.max(0, Math.round(mask.x * visualWidth)));
    const y = Math.min(visualHeight - 2, Math.max(0, Math.round(mask.y * visualHeight)));
    const width = Math.min(visualWidth - x, Math.max(2, Math.round(mask.width * visualWidth)));
    const height = Math.min(visualHeight - y, Math.max(2, Math.round(mask.height * visualHeight)));
    const lumaRadius = Math.max(
      0,
      Math.min(Math.round(mask.blur), Math.floor(Math.min(width, height) / 2) - 1),
    );
    const chromaRadius = Math.max(
      0,
      Math.min(lumaRadius, Math.floor(Math.min(width, height) / 4) - 1),
    );
    const base = `mask-base-${sequence}`;
    const source = `mask-source-${sequence}`;
    const patch = `mask-patch-${sequence}`;
    const next = `video-${++sequence}`;
    filters.push(`[${current}]split=2[${base}][${source}]`);
    filters.push(
      `[${source}]crop=${width}:${height}:${x}:${y},boxblur=luma_radius=${lumaRadius}:luma_power=1:chroma_radius=${chromaRadius}:chroma_power=1[${patch}]`,
    );
    filters.push(
      `[${base}][${patch}]overlay=${x}:${y}:enable='between(t,${range.start},${range.end})'[${next}]`,
    );
    current = next;
  }

  const zoomSegments = normalized.zoomSegments
    .map((segment) => ({ range: effectRange(segment, normalized), segment }))
    .filter(({ range }) => range);
  if (zoomSegments.length) {
    const zoom = nestedZoomExpression(zoomSegments, animatedZoomExpression, '1');
    const x = nestedZoomExpression(
      zoomSegments,
      (segment) =>
        segment.mode === 'manual'
          ? `clip(iw*${segment.focusX.toFixed(4)}-iw/(2*zoom),0,iw-iw/zoom)`
          : 'iw/2-(iw/zoom/2)',
      '0',
    );
    const y = nestedZoomExpression(
      zoomSegments,
      (segment) =>
        segment.mode === 'manual'
          ? `clip(ih*${segment.focusY.toFixed(4)}-ih/(2*zoom),0,ih-ih/zoom)`
          : 'ih/2-(ih/zoom/2)',
      '0',
    );
    const next = `video-${++sequence}`;
    filters.push(
      `[${current}]zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=${evenSize(visualWidth)}x${evenSize(visualHeight)}:fps=30[${next}]`,
    );
    current = next;
  }

  if (normalized.shareEnabled) {
    const { width: canvasWidth, height: canvasHeight } = shareCanvasSize(normalized.share.ratioId);
    const layout = shareImageLayout(
      sourceWidth,
      sourceHeight,
      canvasWidth,
      canvasHeight,
      normalized.share,
    );
    const videoWidth = evenSize(layout.width);
    const videoHeight = evenSize(layout.height);
    const videoX = Math.round((canvasWidth - videoWidth) / 2);
    const videoY = Math.round((canvasHeight - videoHeight) / 2);
    const next = `video-${++sequence}`;
    filters.push(
      `[${current}]scale=${videoWidth}:${videoHeight}:flags=lanczos,format=rgba[share-video]`,
    );
    filters.push('[2:v]format=gray[share-mask]');
    filters.push('[share-video][share-mask]alphamerge[share-rounded]');
    filters.push('[1:v]format=rgba[share-background]');
    filters.push(
      `[share-background][share-rounded]overlay=${videoX}:${videoY}:shortest=1,format=yuv420p[${next}]`,
    );
    current = next;
    visualWidth = canvasWidth;
    visualHeight = canvasHeight;
  }

  for (const caption of normalized.captions) {
    const range = effectRange(caption, normalized);
    if (!range) continue;
    const next = `video-${++sequence}`;
    filters.push(
      `[${current}]drawtext=font='Sans':text='${filterText(caption.text)}':fontcolor=white:fontsize=h*0.055:box=1:boxcolor=black@0.58:boxborderw=14:x=(w-text_w)/2:y=h-text_h-h*0.065:enable='between(t,${range.start},${range.end})'[${next}]`,
    );
    current = next;
  }

  if (Math.abs(normalized.speed - 1) > 1e-9) {
    const next = `video-${++sequence}`;
    filters.push(`[${current}]setpts=PTS/${normalized.speed.toFixed(3)}[${next}]`);
    current = next;
  }

  if (normalized.shareEnabled) filters.push(`[${current}]format=yuv420p[outv]`);
  else {
    filters.push(
      `[${current}]scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p[outv]`,
    );
  }

  return {
    filterComplex: filters.join(';'),
    normalized,
    outputDurationUs: selectedVideoDurationUs(normalized, durationUs),
  };
}

export function buildVideoExportArguments(
  sourcePath,
  temporaryPath,
  edit,
  durationUs,
  options = {},
) {
  const { filterComplex, normalized, outputDurationUs } = buildVideoFilterGraph(
    edit,
    durationUs,
    options,
  );
  const args = [
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-ss',
    secondsArgument(normalized.trimStartUs),
    '-i',
    sourcePath,
  ];
  if (normalized.shareEnabled) {
    if (!options.backdropPath || !options.maskPath)
      throw new Error('The share-video render assets are unavailable.');
    args.push(
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      options.backdropPath,
      '-loop',
      '1',
      '-framerate',
      '30',
      '-i',
      options.maskPath,
    );
  }
  args.push('-filter_complex', filterComplex, '-map', '[outv]');
  if (normalized.muted) args.push('-an');
  else {
    args.push('-map', '0:a:0?');
    const audioFilters = [
      `atrim=duration=${secondsArgument(normalized.trimEndUs - normalized.trimStartUs)}`,
      'asetpts=PTS-STARTPTS',
      `volume=${normalized.audioVolume.toFixed(3)}`,
    ];
    if (Math.abs(normalized.speed - 1) > 1e-9)
      audioFilters.push(`atempo=${normalized.speed.toFixed(3)}`);
    args.push('-af', audioFilters.join(','));
  }
  args.push(
    '-sn',
    '-dn',
    '-t',
    secondsArgument(outputDurationUs),
    '-c:v',
    'libvpx-vp9',
    '-deadline',
    'good',
    '-cpu-used',
    '4',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-row-mt',
    '1',
  );
  if (!normalized.muted) args.push('-c:a', 'libopus', '-b:a', '128k');
  args.push('-map_metadata', '-1', '-f', 'webm', '-n', temporaryPath);
  return args;
}

function runExporter(args, cancellable) {
  if (cancellable?.is_cancelled()) return Promise.reject(cancellationError());

  let process;
  try {
    process = Gio.Subprocess.new(args, Gio.SubprocessFlags.STDERR_PIPE);
  } catch (_error) {
    return Promise.reject(
      new Error('The FFmpeg video exporter is unavailable. Install FFmpeg and try again.'),
    );
  }

  return new Promise((resolve, reject) => {
    const cancelId =
      cancellable?.connect(() => {
        try {
          process.force_exit();
        } catch (_error) {
          // The process may already have exited between cancellation and this callback.
        }
      }) ?? 0;

    process.communicate_utf8_async(null, null, (subprocess, result) => {
      if (cancelId) cancellable.disconnect(cancelId);
      try {
        const [, , stderr] = subprocess.communicate_utf8_finish(result);
        if (cancellable?.is_cancelled()) throw cancellationError();
        if (!subprocess.get_successful()) {
          const detail = String(stderr ?? '')
            .trim()
            .split('\n')
            .slice(-4)
            .join(' ');
          throw new Error(
            detail
              ? `Video export failed: ${detail}`
              : 'Video export failed. Check that the source video and its codecs are supported.',
          );
        }
        resolve(true);
      } catch (error) {
        reject(cancellable?.is_cancelled() ? cancellationError() : error);
      }
    });
  });
}

function writeRenderSurface(surface, path) {
  try {
    surface.writeToPNG(path);
    if (GLib.chmod(path, 0o600) !== 0)
      throw new Error('Could not secure the temporary video render asset.');
  } finally {
    surface.finish();
  }
}

function createShareRenderAssets(directory, stem, edit, sourceWidth, sourceHeight) {
  const backdropPath = GLib.build_filenamev([directory, `.${stem}.backdrop.png`]);
  const maskPath = GLib.build_filenamev([directory, `.${stem}.mask.png`]);
  const { width: canvasWidth, height: canvasHeight } = shareCanvasSize(edit.share.ratioId);
  const layout = shareImageLayout(sourceWidth, sourceHeight, canvasWidth, canvasHeight, edit.share);
  try {
    writeRenderSurface(
      renderShareVideoBackdrop(sourceWidth, sourceHeight, edit.share),
      backdropPath,
    );
    writeRenderSurface(
      renderShareVideoMask(evenSize(layout.width), evenSize(layout.height), layout.radius),
      maskPath,
    );
    return { backdropPath, maskPath };
  } catch (error) {
    for (const path of [backdropPath, maskPath]) {
      if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
    }
    throw error;
  }
}

export async function exportEditedVideo({
  cancellable = null,
  durationUs,
  edit,
  sourceHeight = 0,
  sourcePath,
  sourceWidth = 0,
  targetPath,
}) {
  const inputPath = String(sourcePath ?? '');
  const outputPath = String(targetPath ?? '');
  if (!inputPath || !GLib.path_is_absolute(inputPath))
    throw new Error('Choose a local source video.');
  if (!outputPath || !GLib.path_is_absolute(outputPath))
    throw new Error('Choose a local export path.');
  if (!Gio.File.new_for_path(inputPath).query_exists(null))
    throw new Error('The source video is no longer available.');
  if (canonicalPath(inputPath) === canonicalPath(outputPath))
    throw new Error('Choose a new filename. Bolas never overwrites the original video.');
  if (GLib.file_test(outputPath, GLib.FileTest.EXISTS))
    throw new Error(`A file named ${GLib.path_get_basename(outputPath)} already exists.`);

  const directory = GLib.path_get_dirname(outputPath);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the video export directory.');
  const renderId = `${GLib.path_get_basename(outputPath)}.${GLib.uuid_string_random()}`;
  const temporaryPath = GLib.build_filenamev([directory, `.${renderId}.tmp.webm`]);
  const normalized = normalizeVideoEdit(edit, durationUs);
  let assets = { backdropPath: null, maskPath: null };

  try {
    if (normalized.shareEnabled)
      assets = createShareRenderAssets(
        directory,
        renderId,
        normalized,
        Number(sourceWidth),
        Number(sourceHeight),
      );
    const args = buildVideoExportArguments(inputPath, temporaryPath, normalized, durationUs, {
      ...assets,
      sourceHeight,
      sourceWidth,
    });
    await runExporter(args, cancellable);
    if (GLib.chmod(temporaryPath, 0o600) !== 0)
      throw new Error('Could not secure the exported video.');
    Gio.File.new_for_path(temporaryPath).move(
      Gio.File.new_for_path(outputPath),
      Gio.FileCopyFlags.NONE,
      null,
      null,
    );
    return { mimeType: 'video/webm', path: outputPath };
  } finally {
    for (const path of [assets.backdropPath, assets.maskPath, temporaryPath]) {
      if (path && GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
    }
  }
}

export function createManagedVideoPath(sourcePath, appId = APP_ID) {
  const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), appId, 'video-exports']);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the managed video directory.');
  if (GLib.chmod(directory, 0o700) !== 0)
    throw new Error('Could not secure the managed video directory.');

  const basename = GLib.path_get_basename(String(sourcePath ?? 'video'));
  const dot = basename.lastIndexOf('.');
  const rawStem = dot > 0 ? basename.slice(0, dot) : basename;
  const stem = rawStem.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'video';
  return GLib.build_filenamev([directory, `${stem}-edited-${GLib.uuid_string_random()}.webm`]);
}
