import System from 'system';

import { buildVideoAutoFocusArguments } from '../src/services/video-auto-focus.js';
import { autoFocusSampleRate, detectInputFocusSegments } from '../src/video/auto-focus.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function frame(width, height, timestampUs, paint = null) {
  const data = new Uint8Array(width * height);
  data.fill(48);
  paint?.(data, width, height);
  return { data, height, timestampUs, width };
}

function paintTypedCharacters(data, width, count, originX = 12, originY = 18) {
  for (let character = 0; character < count; character++) {
    const left = originX + character * 5;
    for (let y = originY; y < originY + 7; y++) {
      for (let x = left; x < left + 3; x++) data[y * width + x] = 220;
    }
  }
}

try {
  const width = 96;
  const height = 54;
  const typingFrames = Array.from({ length: 7 }, (_, index) =>
    frame(width, height, index * 250_000, (data) => paintTypedCharacters(data, width, index)),
  );
  const detected = detectInputFocusSegments(typingFrames, {
    trimEndUs: 2_000_000,
    trimStartUs: 0,
  });
  assert(detected.length === 1, 'one sustained typing region must create one focus segment');
  assert(detected[0].source === 'input', 'detected focus must retain its input origin');
  assert(detected[0].mode === 'manual', 'detected focus must use its measured focus point');
  assert(detected[0].focusX < 0.5, 'focus must follow the typed content instead of the center');
  assert(detected[0].scale >= 1.25, 'input focus must produce a readable magnification');
  assert(detected[0].endUs > detected[0].startUs, 'input focus must have a non-empty range');

  const sceneFrames = [
    frame(width, height, 0),
    frame(width, height, 250_000, (data) => data.fill(240)),
    frame(width, height, 500_000),
    frame(width, height, 750_000, (data) => data.fill(240)),
  ];
  assert(
    detectInputFocusSegments(sceneFrames, { trimEndUs: 1_000_000 }).length === 0,
    'whole-frame scene changes must not be mistaken for typing',
  );

  assert(autoFocusSampleRate(10_000_000) === 4, 'short videos must use the full sample rate');
  assert(
    autoFocusSampleRate(600_000_000) <= 0.8,
    'long videos must stay within the bounded sample count',
  );
  const sample = buildVideoAutoFocusArguments('/video.webm', '/tmp/%06d.pgm', {
    endUs: 10_000_000,
    startUs: 1_000_000,
  });
  assert(sample.args.includes('-threads'), 'analysis must bound FFmpeg threads');
  assert(sample.args.includes('-frames:v'), 'analysis must cap the extracted frame count');
  assert(sample.args.includes('-ss'), 'analysis must honor the selected range start');
  assert(sample.args.includes('-t'), 'analysis must honor the selected range duration');
  assert(
    sample.args.some((argument) => argument.includes('scale=320:')),
    'analysis frames must be downscaled before inspection',
  );

  print('video automatic input focus is valid');
  System.exit(0);
} catch (error) {
  printerr(error.message);
  printerr(error.stack ?? error.message);
  System.exit(1);
}
