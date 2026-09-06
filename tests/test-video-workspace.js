import System from 'system';

import {
  decodeWorkspace,
  encodeWorkspace,
  WORKSPACE_MAGIC_TEXT,
} from '../src/services/workspace-file.js';
import {
  createVideoWorkspace,
  normalizeVideoWorkspace,
  VIDEO_WORKSPACE_VERSION,
  videoWorkspaceSourceBytes,
} from '../src/video/workspace.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBytesEqual(actual, expected, message) {
  assert(actual.length === expected.length, message);
  assert(
    actual.every((byte, index) => byte === expected[index]),
    message,
  );
}

try {
  const sourceBytes = new Uint8Array([26, 69, 223, 163, 147, 66, 130, 136, 1, 2, 3, 4]);
  const workspace = createVideoWorkspace({
    edit: {
      audioVolume: 0.7,
      captions: [{ endUs: 3_000_000, id: 'caption-1', startUs: 1_000_000, text: 'Hello' }],
      masks: [
        {
          blur: 24,
          endUs: 4_000_000,
          height: 0.2,
          id: 'mask-1',
          startUs: 2_000_000,
          width: 0.3,
          x: 0.1,
          y: 0.15,
        },
      ],
      muted: false,
      share: {
        cornerRadius: 28,
        padding: 0.11,
        presetId: 'midnight',
        ratioId: 'wide',
        shadow: true,
        shadowStrength: 0.8,
      },
      shareEnabled: true,
      speed: 1.25,
      trimEndUs: 7_500_000,
      trimStartUs: 500_000,
      zoomSegments: [
        {
          endUs: 2_500_000,
          focusX: 0.7,
          focusY: 0.4,
          id: 'zoom-1',
          mode: 'manual',
          scale: 1.6,
          startUs: 1_000_000,
        },
      ],
    },
    session: { timestampUs: 2_250_000 },
    sourceBytes,
    sourceMetadata: {
      displayName: 'recording.webm',
      durationUs: 8_000_000,
      height: 1080,
      originalMimeType: 'video/webm',
      width: 1920,
    },
  });

  const encoded = encodeWorkspace(workspace);
  assert(
    new TextDecoder().decode(encoded.slice(0, 8)) === WORKSPACE_MAGIC_TEXT,
    'workspace magic header is missing',
  );
  const restored = decodeWorkspace(encoded);
  assert(restored.kind === 'video', 'video workspace kind changed');
  assert(restored.version === VIDEO_WORKSPACE_VERSION, 'video workspace version changed');
  assert(restored.source.displayName === 'recording.webm', 'source name was lost');
  assert(restored.source.durationUs === 8_000_000, 'source duration was lost');
  assert(restored.edit.trimStartUs === 500_000, 'trim start was lost');
  assert(restored.edit.trimEndUs === 7_500_000, 'trim end was lost');
  assert(restored.edit.speed === 1.25, 'playback speed was lost');
  assert(restored.edit.captions[0]?.text === 'Hello', 'caption was lost');
  assert(restored.edit.zoomSegments[0]?.focusX === 0.7, 'zoom focus was lost');
  assert(restored.edit.masks[0]?.blur === 24, 'blur mask was lost');
  assert(restored.edit.share.presetId === 'midnight', 'share background was lost');
  assert(restored.session.timestampUs === 2_250_000, 'playhead position was lost');
  assertBytesEqual(videoWorkspaceSourceBytes(restored), sourceBytes, 'source video bytes changed');

  const future = JSON.parse(JSON.stringify(workspace));
  future.version = VIDEO_WORKSPACE_VERSION + 1;
  let rejectedFuture = false;
  try {
    normalizeVideoWorkspace(future);
  } catch {
    rejectedFuture = true;
  }
  assert(rejectedFuture, 'future video workspace version was accepted');

  const wrongKind = JSON.parse(JSON.stringify(workspace));
  wrongKind.kind = 'image';
  let rejectedKind = false;
  try {
    normalizeVideoWorkspace(wrongKind);
  } catch {
    rejectedKind = true;
  }
  assert(rejectedKind, 'an image workspace was accepted as a video project');

  const damaged = JSON.parse(JSON.stringify(workspace));
  damaged.source.asset.sha256 = '0'.repeat(64);
  let rejectedChecksum = false;
  try {
    normalizeVideoWorkspace(damaged);
  } catch {
    rejectedChecksum = true;
  }
  assert(rejectedChecksum, 'damaged source video bytes were accepted');

  print('video workspace serialization is valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}
