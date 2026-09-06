import System from 'system';

import { LatestFrameCoalescer } from '../src/video/frame-coalescer.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  let nextFrameId = 1;
  const callbacks = new Map();
  const cancelled = [];
  const applied = [];
  const coalescer = new LatestFrameCoalescer({
    apply: (value) => applied.push(value),
    cancelFrame: (frameId) => {
      cancelled.push(frameId);
      callbacks.delete(frameId);
    },
    requestFrame: (callback) => {
      const frameId = nextFrameId++;
      callbacks.set(frameId, callback);
      return frameId;
    },
  });

  coalescer.queue({ timestampUs: 100_000 });
  coalescer.queue({ timestampUs: 200_000 });
  coalescer.queue({ timestampUs: 300_000 });
  assert(callbacks.size === 1, 'rapid updates must schedule only one frame callback');
  assert(coalescer.scheduled, 'a queued update must report a scheduled frame');

  callbacks.get(1)();
  callbacks.delete(1);
  assert(applied.length === 1, 'one frame must apply exactly one update');
  assert(applied[0].timestampUs === 300_000, 'the frame must apply the latest queued update');
  assert(!coalescer.scheduled, 'the coalescer must become idle after the frame runs');

  coalescer.queue({ timestampUs: 400_000 });
  coalescer.flush();
  assert(applied.at(-1).timestampUs === 400_000, 'flush must apply the pending update');
  assert(cancelled.includes(2), 'flush must cancel the redundant scheduled frame callback');

  coalescer.queue({ timestampUs: 500_000 });
  coalescer.cancel();
  assert(cancelled.includes(3), 'cancel must remove the scheduled frame callback');
  assert(applied.length === 2, 'cancel must discard rather than apply pending work');

  print('video frame updates coalesce to the latest value');
  System.exit(0);
} catch (error) {
  printerr(error.stack ?? error.message);
  System.exit(1);
}
