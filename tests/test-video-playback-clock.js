import System from 'system';

import { PlaybackClock } from '../src/video/playback-clock.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const clock = new PlaybackClock();
  const startFrameTimeUs = 8_000_000;
  let timestamp = clock.sample({
    frameTimeUs: startFrameTimeUs,
    mediaTimestampUs: 2_000_000,
    playing: true,
  });
  assert(timestamp === 2_000_000, 'playback must start at the media timestamp');

  for (let frame = 1; frame <= 60; frame++) {
    timestamp = clock.sample({
      frameTimeUs: startFrameTimeUs + frame * 16_667,
      mediaTimestampUs: 2_000_000,
      playing: true,
    });
  }
  assert(
    timestamp >= 3_000_000 && timestamp <= 3_001_000,
    'a sparse backend timestamp must advance smoothly at display-frame cadence',
  );

  const refreshed = clock.sample({
    frameTimeUs: startFrameTimeUs + 1_016_687,
    mediaTimestampUs: 3_000_000,
    playing: true,
  });
  assert(refreshed >= timestamp, 'a delayed backend update must not move playback backwards');

  const caughtUp = clock.sample({
    frameTimeUs: startFrameTimeUs + 1_033_354,
    mediaTimestampUs: 3_200_000,
    playing: true,
  });
  assert(caughtUp >= 3_200_000, 'an ahead-of-clock backend update must catch playback up');

  const paused = clock.sample({
    frameTimeUs: startFrameTimeUs + 1_050_021,
    mediaTimestampUs: 3_150_000,
    playing: false,
  });
  assert(paused === 3_150_000, 'pausing must reconcile to the exact media timestamp');

  const backendSeek = clock.sample({
    frameTimeUs: startFrameTimeUs + 1_058_354,
    mediaTimestampUs: 3_150_000,
    playing: false,
    seeking: true,
  });
  assert(
    backendSeek === 3_150_000,
    'a backend seek without a requested target must retain the media timestamp',
  );

  const seeked = clock.sample({
    frameTimeUs: startFrameTimeUs + 1_066_688,
    mediaTimestampUs: 3_150_000,
    playing: false,
    requestedTimestampUs: 750_000,
    seeking: true,
  });
  assert(seeked === 750_000, 'an in-flight seek must present its requested timestamp');

  print('video playback clock advances smoothly between sparse media updates');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}
