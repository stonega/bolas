import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gst from 'gi://Gst?version=1.0';
import GstPbutils from 'gi://GstPbutils?version=1.0';
import System from 'system';

import {
  buildVideoExportArguments,
  buildVideoFilterGraph,
  exportEditedVideo,
  isVideoExportCancellation,
} from '../src/services/video-export.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function hasWorkingH264Encoder() {
  // Fedora's noopenh264 library advertises an encoder but cannot encode frames.
  return ['libx264', 'libopenh264'].some((encoder) => {
    const probe = Gio.Subprocess.new(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'color=size=32x32:rate=1',
        '-frames:v',
        '1',
        '-c:v',
        encoder,
        '-f',
        'null',
        '-',
      ],
      Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE,
    );
    probe.wait(null);
    return probe.get_successful();
  });
}

Gst.init(null);
const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-video-export-${GLib.uuid_string_random()}`,
]);
const sourcePath = GLib.build_filenamev([root, 'source.webm']);
const outputPath = GLib.build_filenamev([root, 'trimmed.webm']);
const audioOutputPath = GLib.build_filenamev([root, 'with-audio.webm']);
const composedOutputPath = GLib.build_filenamev([root, 'composed.webm']);
const silentSourcePath = GLib.build_filenamev([root, 'silent-source.webm']);
const silentOutputPath = GLib.build_filenamev([root, 'silent-output.webm']);
const cancelledOutputPath = GLib.build_filenamev([root, 'cancelled.webm']);
const mp4OutputPath = GLib.build_filenamev([root, 'export.mp4']);
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
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '1.2',
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-c:a',
      'libopus',
      '-f',
      'webm',
      '-n',
      sourcePath,
    ],
    Gio.SubprocessFlags.NONE,
  );
  assert(generator.wait_check(null), 'could not create the source video fixture');

  const edit = { muted: true, trimEndUs: 900_000, trimStartUs: 300_000 };
  const args = buildVideoExportArguments(sourcePath, `${outputPath}.tmp`, edit, 1_200_000);
  assert(args.includes('-an'), 'muted export must remove the audio stream');
  assert(args.includes('libvpx-vp9'), 'video export must use the VP9 encoder');
  const mp4Args = buildVideoExportArguments(sourcePath, mp4OutputPath, {}, 1_200_000, {
    format: 'mp4',
  });
  assert(
    mp4Args.includes('libx264') && mp4Args.includes('aac') && mp4Args.includes('+faststart'),
    'MP4 must use H.264/AAC and support fast start',
  );
  const progress = [];

  await exportEditedVideo({
    durationUs: 1_200_000,
    edit,
    sourcePath,
    targetPath: outputPath,
    onProgress: (value) => {
      progress.push(value.fraction);
      if (value.fraction === 1)
        assert(
          Gio.File.new_for_path(outputPath).query_exists(null),
          'progress completed before the output existed',
        );
    },
  });
  const fractions = progress.filter((value) => value !== null);
  assert(
    fractions.length > 2 && fractions.at(-1) === 1,
    'video progress must include encoding and completion',
  );
  assert(
    fractions.every((value, index) => index === 0 || value >= fractions[index - 1]),
    'video progress moved backwards',
  );
  assert(GLib.file_test(outputPath, GLib.FileTest.EXISTS), 'edited WebM was not created');

  const discoverer = GstPbutils.Discoverer.new(5 * Gst.SECOND);
  const info = discoverer.discover_uri(Gio.File.new_for_path(outputPath).get_uri());
  const duration = Number(info.get_duration());
  assert(duration >= 500_000_000 && duration <= 750_000_000, 'trimmed duration is incorrect');
  assert(info.get_video_streams().length === 1, 'edited output must contain one video stream');
  assert(info.get_audio_streams().length === 0, 'muted output must not contain audio');

  await exportEditedVideo({
    durationUs: 1_200_000,
    edit: { muted: false, trimEndUs: 600_000, trimStartUs: 0 },
    sourcePath,
    targetPath: audioOutputPath,
  });
  const audioInfo = discoverer.discover_uri(Gio.File.new_for_path(audioOutputPath).get_uri());
  assert(audioInfo.get_audio_streams().length === 1, 'unmuted output must retain audio');
  const mp4Options = {
    durationUs: 1_200_000,
    edit: { muted: false, speed: 1.5, trimStartUs: 300_000, trimEndUs: 900_000 },
    format: 'mp4',
    sourcePath,
    targetPath: mp4OutputPath,
  };
  if (hasWorkingH264Encoder()) {
    const mp4 = await exportEditedVideo(mp4Options);
    assert(mp4.mimeType === 'video/mp4', 'MP4 MIME type is incorrect');
    const probe = Gio.Subprocess.new(
      ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', mp4OutputPath],
      Gio.SubprocessFlags.STDOUT_PIPE,
    );
    const [, probeOutput] = probe.communicate_utf8(null, null);
    assert(probe.get_successful(), 'could not inspect the MP4 output');
    const metadata = JSON.parse(probeOutput);
    assert(
      metadata.streams.some((stream) => stream.codec_name === 'h264'),
      'MP4 video codec is incorrect',
    );
    assert(
      metadata.streams.some((stream) => stream.codec_name === 'aac'),
      'MP4 audio codec is incorrect',
    );
    assert(
      Number(metadata.format.duration) >= 0.35 && Number(metadata.format.duration) <= 0.55,
      'MP4 trim/speed was lost',
    );
    print('MP4 H.264/AAC export is valid');
  } else {
    let encoderError = null;
    try {
      await exportEditedVideo(mp4Options);
    } catch (error) {
      encoderError = error;
    }
    assert(
      /H\.264 encoder|MP4 encoding/.test(encoderError?.message ?? ''),
      'missing H.264 support must report an encoding error',
    );
    assert(
      !GLib.file_test(mp4OutputPath, GLib.FileTest.EXISTS),
      'failed MP4 export must not publish an output file',
    );
    const children = Gio.File.new_for_path(root).enumerate_children(
      'standard::name',
      Gio.FileQueryInfoFlags.NONE,
      null,
    );
    try {
      for (let child = children.next_file(null); child; child = children.next_file(null))
        assert(!child.get_name().startsWith('.export.mp4.'), 'failed MP4 staging was not removed');
    } finally {
      children.close(null);
    }
    print('H.264 is unavailable; MP4 failure and cleanup are valid');
    GLib.file_set_contents(mp4OutputPath, 'existing destination');
  }
  let refused = false;
  try {
    await exportEditedVideo({
      durationUs: 1_200_000,
      edit: {},
      format: 'mp4',
      sourcePath,
      targetPath: mp4OutputPath,
    });
  } catch {
    refused = true;
  }
  assert(refused, 'existing MP4 destination must be refused');

  const silentGenerator = Gio.Subprocess.new(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-i',
      sourcePath,
      '-an',
      '-c:v',
      'copy',
      '-n',
      silentSourcePath,
    ],
    Gio.SubprocessFlags.NONE,
  );
  assert(silentGenerator.wait_check(null), 'could not create the silent video fixture');
  await exportEditedVideo({
    durationUs: 1_200_000,
    edit: { muted: false },
    sourcePath: silentSourcePath,
    targetPath: silentOutputPath,
  });
  const silentInfo = discoverer.discover_uri(Gio.File.new_for_path(silentOutputPath).get_uri());
  assert(silentInfo.get_audio_streams().length === 0, 'silent video export added an audio stream');

  const composedEdit = {
    audioVolume: 0.8,
    captions: [{ endUs: 600_000, startUs: 0, text: 'Focus here' }],
    masks: [
      {
        blur: 8,
        endUs: 700_000,
        height: 0.2,
        startUs: 100_000,
        width: 0.2,
        x: 0.4,
        y: 0.4,
      },
    ],
    shareEnabled: true,
    speed: 1.5,
    trimEndUs: 900_000,
    zoomSegments: [
      {
        endUs: 600_000,
        focusX: 0.3,
        focusY: 0.6,
        mode: 'manual',
        scale: 1.3,
        startUs: 0,
      },
    ],
  };
  const graph = buildVideoFilterGraph(composedEdit, 1_200_000, {
    sourceHeight: 90,
    sourceWidth: 160,
  }).filterComplex;
  assert(graph.includes('zoompan='), 'zoom segments must be present in the filter graph');
  assert(graph.includes('cos(PI*'), 'zoom segments must use smooth focus transitions');
  assert(graph.includes('clip(iw*'), 'manual focus must clamp the measured horizontal point');
  assert(graph.includes('drawtext='), 'captions must be present in the filter graph');
  assert(graph.includes('boxblur='), 'blur masks must be present in the filter graph');
  assert(graph.includes('alphamerge'), 'share videos must use the rounded-corner mask');
  assert(
    graph.indexOf('boxblur=') < graph.indexOf('zoompan=') &&
      graph.indexOf('zoompan=') < graph.indexOf('alphamerge'),
    'blur and zoom must affect the imported video before share-canvas composition',
  );
  assert(
    graph.indexOf('alphamerge') < graph.indexOf('drawtext='),
    'captions must remain on the composed canvas outside recording-only effects',
  );
  assert(
    graph.includes('crop=32:18:64:36'),
    'mask coordinates must be measured against the imported video',
  );
  assert(
    graph.includes('s=160x90:fps=30'),
    'zoom must transform only the imported video dimensions',
  );

  await exportEditedVideo({
    durationUs: 1_200_000,
    edit: composedEdit,
    sourceHeight: 90,
    sourcePath,
    sourceWidth: 160,
    targetPath: composedOutputPath,
  });
  const composedInfo = discoverer.discover_uri(Gio.File.new_for_path(composedOutputPath).get_uri());
  const composedVideo = composedInfo.get_video_streams()[0];
  assert(composedVideo.get_width() === 1600, 'share video width must follow the canvas ratio');
  assert(composedVideo.get_height() === 1200, 'share video height must follow the canvas ratio');
  assert(composedInfo.get_audio_streams().length === 1, 'share video must retain edited audio');
  const composedDuration = Number(composedInfo.get_duration());
  assert(
    composedDuration >= 500_000_000 && composedDuration <= 750_000_000,
    'share video speed did not retime the output',
  );

  const cancellable = new Gio.Cancellable();
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    cancellable.cancel();
    return GLib.SOURCE_REMOVE;
  });
  let cancelled = false;
  try {
    await exportEditedVideo({
      cancellable,
      durationUs: 1_200_000,
      edit: {},
      sourcePath,
      targetPath: cancelledOutputPath,
    });
  } catch (error) {
    cancelled = isVideoExportCancellation(error);
  }
  assert(cancelled, 'a cancelled export must report cancellation');
  assert(
    !GLib.file_test(cancelledOutputPath, GLib.FileTest.EXISTS),
    'a cancelled export must not leave an output file',
  );

  print('video export is valid');
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  for (const path of [
    audioOutputPath,
    mp4OutputPath,
    cancelledOutputPath,
    composedOutputPath,
    outputPath,
    silentOutputPath,
    silentSourcePath,
    sourcePath,
  ]) {
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  }
  if (GLib.file_test(root, GLib.FileTest.IS_DIR)) GLib.rmdir(root);
}

System.exit(exitCode);
