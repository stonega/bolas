import System from 'system';

import { createAnnotation, ImageDocument } from '../src/editor/document.js';
import {
  createImageWorkspace,
  decodeWorkspaceAsset,
  IMAGE_WORKSPACE_VERSION,
  normalizeImageWorkspace,
  workspaceSourceBytes,
} from '../src/editor/workspace.js';
import {
  decodeImageWorkspace,
  encodeImageWorkspace,
  WORKSPACE_MAGIC_TEXT,
} from '../src/services/workspace-file.js';

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
  const sourceBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const image = new ImageDocument({ height: 600, width: 800 });
  const rectangle = image.addAnnotation(
    createAnnotation('rectangle', {
      fillColor: '#3584e4',
      rect: { height: 0.25, width: 0.3, x: 0.1, y: 0.2 },
    }),
  );
  image.addAnnotation(
    createAnnotation('text', {
      fontFamily: 'Cantarell',
      text: 'Editable after reopen',
      x: 0.25,
      y: 0.4,
    }),
  );
  image.addAnnotation(
    createAnnotation('line', {
      end: { x: 0.8, y: 0.8 },
      start: { x: 0.2, y: 0.2 },
    }),
  );
  image.addAnnotation(
    createAnnotation('arrow', {
      bend: { x: 0.5, y: 0.2 },
      end: { x: 0.85, y: 0.35 },
      start: { x: 0.15, y: 0.7 },
    }),
  );
  image.addAnnotation(
    createAnnotation('ellipse', {
      rect: { height: 0.18, width: 0.22, x: 0.55, y: 0.5 },
    }),
  );
  image.crop({ height: 0.9, width: 0.9, x: 0.05, y: 0.05 });
  image.rotate(1);
  image.flip('horizontal');
  image.updateAnnotation(rectangle.id, { opacity: 0.55 });
  image.undo();
  image.select(rectangle.id);

  const canvas = new ImageDocument({ height: 900, width: 1600 });
  const pencil = canvas.addAnnotation(
    createAnnotation('pencil', {
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.3 },
      ],
    }),
  );
  canvas.select(pencil.id);

  const workspace = createImageWorkspace({
    canvasDocument: canvas,
    composition: {
      backgroundEnabled: true,
      settings: {
        cornerRadius: 24,
        padding: 0.12,
        presetId: 'midnight',
        ratioId: 'wide',
        shadow: true,
        shadowStrength: 0.7,
      },
    },
    imageDocument: image,
    session: {
      activeLayer: 'canvas',
      cropPortrait: false,
      cropRatioId: '16:9',
      cropRect: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
      fit: false,
      mode: 'draw',
      panX: 12,
      panY: -8,
      sidebarKind: 'draw',
      tool: 'pencil',
      zoomFactor: 1.75,
    },
    sourceBytes,
    sourceMetadata: {
      displayName: 'source.png',
      height: 600,
      originalMimeType: 'image/png',
      width: 800,
    },
  });

  const encoded = encodeImageWorkspace(workspace);
  assert(
    new TextDecoder().decode(encoded.slice(0, 8)) === WORKSPACE_MAGIC_TEXT,
    'workspace magic header is missing',
  );
  const restoredWorkspace = decodeImageWorkspace(encoded);
  assert(restoredWorkspace.version === IMAGE_WORKSPACE_VERSION, 'workspace version changed');
  assert(restoredWorkspace.composition.settings.presetId === 'midnight', 'background was lost');
  assert(restoredWorkspace.session.activeLayer === 'canvas', 'active layer was lost');
  assert(restoredWorkspace.session.cropRect.width === 0.8, 'crop draft was lost');
  assertBytesEqual(workspaceSourceBytes(restoredWorkspace), sourceBytes, 'source bytes changed');

  const restoredImage = ImageDocument.fromWorkspaceSnapshot(restoredWorkspace.documents.image);
  const restoredCanvas = ImageDocument.fromWorkspaceSnapshot(restoredWorkspace.documents.canvas);
  assert(restoredImage.annotations.length === 5, 'image annotations were lost');
  assert(
    restoredImage.transforms.map((transform) => transform.type).join(',') === 'crop,rotate,flip',
    'image transforms were lost',
  );
  assert(restoredImage.selectedAnnotation?.id === rectangle.id, 'image selection was lost');
  assert(restoredImage.canRedo, 'redo history was lost');
  assert(restoredImage.redo(), 'restored redo operation failed');
  assert(
    restoredImage.annotations.find((annotation) => annotation.id === rectangle.id)?.opacity ===
      0.55,
    'redo did not restore annotation state',
  );
  assert(restoredCanvas.selectedAnnotation?.id === pencil.id, 'canvas selection was lost');
  assert(restoredCanvas.canUndo, 'canvas undo history was lost');

  const damaged = JSON.parse(JSON.stringify(workspace));
  damaged.source.asset.sha256 = '0'.repeat(64);
  let rejectedChecksum = false;
  try {
    decodeWorkspaceAsset(damaged.source.asset, 'Damaged source');
  } catch {
    rejectedChecksum = true;
  }
  assert(rejectedChecksum, 'asset checksum mismatch was accepted');

  const future = JSON.parse(JSON.stringify(workspace));
  future.version = IMAGE_WORKSPACE_VERSION + 1;
  let rejectedFuture = false;
  try {
    normalizeImageWorkspace(future);
  } catch {
    rejectedFuture = true;
  }
  assert(rejectedFuture, 'future workspace version was accepted');

  const badMagic = encoded.slice();
  badMagic[0] = 0;
  let rejectedMagic = false;
  try {
    decodeImageWorkspace(badMagic);
  } catch {
    rejectedMagic = true;
  }
  assert(rejectedMagic, 'invalid workspace magic was accepted');

  let rejectedTruncated = false;
  try {
    decodeImageWorkspace(encoded.slice(0, Math.max(9, encoded.length - 12)));
  } catch {
    rejectedTruncated = true;
  }
  assert(rejectedTruncated, 'truncated workspace payload was accepted');

  print('image workspace serialization is valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}
