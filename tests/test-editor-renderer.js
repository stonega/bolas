import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { createAnnotation, ImageDocument } from '../src/editor/document.js';
import {
  compositionCanvasSize,
  compositionPointToImage,
  editorSurfaceDimensions,
  encodePixbufPng,
  exportCompositionPng,
  exportDocumentPng,
  fittedSurfaceGeometry,
  imageBoundsInComposition,
  imagePointToComposition,
  loadImageSourceBytes,
  renderCompositionToSurface,
  renderDocumentToSurface,
  saveCompositionForShare,
  saveDocumentForShare,
} from '../src/editor/renderer.js';
import { createImageWorkspace, workspaceSourceBytes } from '../src/editor/workspace.js';
import { decodeImageWorkspace, encodeImageWorkspace } from '../src/services/workspace-file.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function removeIfPresent(path) {
  const file = Gio.File.new_for_path(path);
  if (file.query_exists(null)) {
    file.delete(null);
  }
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-editor-test-${GLib.uuid_string_random()}`,
]);
const sourcePath = GLib.build_filenamev([root, 'source.png']);
const exportPath = GLib.build_filenamev([root, 'export.png']);
const compositionPath = GLib.build_filenamev([root, 'composition.png']);
const workspaceBeforePath = GLib.build_filenamev([root, 'workspace-before.png']);
const workspaceAfterPath = GLib.build_filenamev([root, 'workspace-after.png']);
const managedDirectory = GLib.build_filenamev([root, 'managed']);

try {
  GLib.mkdir_with_parents(root, 0o700);
  const sourcePixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 60);
  sourcePixbuf.fill(0x142033ff);
  const sourceBytes = encodePixbufPng(sourcePixbuf);
  const restoredSource = loadImageSourceBytes(sourceBytes, { displayName: 'workspace-source.png' });
  assert(
    restoredSource.width === 80 && restoredSource.height === 60,
    'workspace source PNG dimensions changed',
  );
  assert(restoredSource.displayName === 'workspace-source.png', 'workspace source name was lost');

  const document = new ImageDocument({ height: 60, width: 80 });
  document.addAnnotation(
    createAnnotation('arrow', {
      bend: { x: 0.45, y: 0.6 },
      end: { x: 0.8, y: 0.25 },
      start: { x: 0.1, y: 0.8 },
      strokeColor: '#ffffff',
    }),
  );
  document.crop({ height: 1, width: 0.75, x: 0, y: 0 });
  document.rotate(1);

  const preview = renderDocumentToSurface(sourcePixbuf, document);
  assert(preview.getWidth() === 60 && preview.getHeight() === 60, 'preview size is incorrect');
  preview.finish();

  const exported = exportDocumentPng(sourcePixbuf, document, exportPath, { sourcePath });
  assert(exported.path === exportPath, 'export returned the wrong path');
  assert(exported.width === 60 && exported.height === 60, 'export dimensions are incorrect');
  assert(Gio.File.new_for_path(exportPath).query_exists(null), 'exported PNG is missing');

  const managed = saveDocumentForShare(sourcePixbuf, document, sourcePath, {
    directory: managedDirectory,
  });
  assert(managed.path.startsWith(`${managedDirectory}/`), 'managed export escaped its directory');
  assert(Gio.File.new_for_path(managed.path).query_exists(null), 'managed PNG is missing');

  const canvasDocument = new ImageDocument({ height: 900, width: 1600 });
  canvasDocument.addAnnotation(
    createAnnotation('rectangle', {
      fillColor: '#ffffff',
      rect: { height: 0.12, width: 0.18, x: 0.06, y: 0.08 },
      strokeColor: '#ffffff',
    }),
  );
  const compositionOptions = {
    padding: 0.1,
    presetId: 'paper',
    ratioId: 'wide',
    shadow: false,
    sourceHasTransparency: false,
  };
  const composition = renderCompositionToSurface(
    sourcePixbuf,
    document,
    canvasDocument,
    compositionOptions,
  );
  assert(
    composition.getWidth() === 1600 && composition.getHeight() === 900,
    'composition preview size is incorrect',
  );
  composition.finish();
  const workspace = decodeImageWorkspace(
    encodeImageWorkspace(
      createImageWorkspace({
        canvasDocument,
        composition: { backgroundEnabled: true, settings: compositionOptions },
        imageDocument: document,
        sourceBytes,
        sourceMetadata: {
          displayName: 'source.png',
          height: 60,
          originalMimeType: 'image/png',
          width: 80,
        },
      }),
    ),
  );
  const workspaceSource = loadImageSourceBytes(workspaceSourceBytes(workspace));
  const restoredImageDocument = ImageDocument.fromWorkspaceSnapshot(workspace.documents.image);
  const restoredCanvasDocument = ImageDocument.fromWorkspaceSnapshot(workspace.documents.canvas);
  const beforeWorkspaceSurface = renderCompositionToSurface(
    sourcePixbuf,
    document,
    canvasDocument,
    compositionOptions,
  );
  const afterWorkspaceSurface = renderCompositionToSurface(
    workspaceSource.pixbuf,
    restoredImageDocument,
    restoredCanvasDocument,
    workspace.composition.settings,
  );
  beforeWorkspaceSurface.writeToPNG(workspaceBeforePath);
  afterWorkspaceSurface.writeToPNG(workspaceAfterPath);
  beforeWorkspaceSurface.finish();
  afterWorkspaceSurface.finish();
  const [, beforeWorkspaceBytes] = GLib.file_get_contents(workspaceBeforePath);
  const [, afterWorkspaceBytes] = GLib.file_get_contents(workspaceAfterPath);
  assert(
    GLib.compute_checksum_for_bytes(
      GLib.ChecksumType.SHA256,
      new GLib.Bytes(beforeWorkspaceBytes),
    ) ===
      GLib.compute_checksum_for_bytes(
        GLib.ChecksumType.SHA256,
        new GLib.Bytes(afterWorkspaceBytes),
      ),
    'workspace round trip changed rendered composition pixels',
  );
  const managedComposition = saveCompositionForShare(
    sourcePixbuf,
    document,
    canvasDocument,
    compositionOptions,
    sourcePath,
    { directory: managedDirectory },
  );
  assert(
    managedComposition.path.startsWith(`${managedDirectory}/`) &&
      managedComposition.path.includes('-share-'),
    'managed composition used the wrong destination',
  );
  assert(
    Gio.File.new_for_path(managedComposition.path).query_exists(null),
    'managed composition PNG is missing',
  );

  const exportedComposition = exportCompositionPng(
    sourcePixbuf,
    document,
    canvasDocument,
    compositionOptions,
    compositionPath,
    { sourcePath },
  );
  assert(exportedComposition.path === compositionPath, 'composition export path is incorrect');
  assert(
    exportedComposition.width === 1600 && exportedComposition.height === 900,
    'composition export dimensions are incorrect',
  );

  const transformedCanvas = new ImageDocument({ height: 1200, width: 1600 });
  transformedCanvas.crop({ height: 0.8, width: 0.75, x: 0.1, y: 0.1 });
  transformedCanvas.rotate(1);
  transformedCanvas.flip('horizontal');
  const sourcePoint = { x: 0.28, y: 0.67 };
  const mappedPoint = imagePointToComposition(
    sourcePoint,
    document.width,
    document.height,
    { padding: 0.1, ratioId: 'landscape' },
    transformedCanvas.transforms,
  );
  const roundTrip = compositionPointToImage(
    mappedPoint,
    document.width,
    document.height,
    { padding: 0.1, ratioId: 'landscape' },
    transformedCanvas.transforms,
  );
  assert(Math.abs(roundTrip.x - sourcePoint.x) < 0.001, 'image layer X mapping is not reversible');
  assert(Math.abs(roundTrip.y - sourcePoint.y) < 0.001, 'image layer Y mapping is not reversible');
  const mappedBounds = imageBoundsInComposition(
    document.width,
    document.height,
    { padding: 0.1, ratioId: 'landscape' },
    transformedCanvas.transforms,
  );
  assert(mappedBounds.width > 0 && mappedBounds.height > 0, 'image layer bounds are invalid');
  const transformedSize = compositionCanvasSize(
    { ratioId: 'landscape' },
    transformedCanvas.transforms,
  );
  assert(
    transformedSize.width === transformedCanvas.width &&
      transformedSize.height === transformedCanvas.height,
    'canvas transform dimensions do not match the canvas document',
  );

  const backgroundFitSize = editorSurfaceDimensions({
    backgroundEnabled: true,
    canvasOptions: compositionOptions,
    imageHeight: document.height,
    imageWidth: document.width,
    renderedHeight: document.height,
    renderedWidth: document.width,
  });
  assert(
    backgroundFitSize.width === 1600 && backgroundFitSize.height === 900,
    'background fit dimensions must ignore a stale image-sized render surface',
  );
  const imageFitSize = editorSurfaceDimensions({
    backgroundEnabled: false,
    imageHeight: document.height,
    imageWidth: document.width,
    renderedHeight: 300,
    renderedWidth: 400,
  });
  assert(
    imageFitSize.width === 400 && imageFitSize.height === 300,
    'image-only fit dimensions must keep using the rendered preview surface',
  );

  const edgeToEdge = fittedSurfaceGeometry(1600, 1600, 1058, 748);
  assert(edgeToEdge.y === 0, 'a composed square canvas did not use the full viewport height');
  assert(
    Math.abs(edgeToEdge.height * edgeToEdge.scale - 748) < 0.001,
    'the edge-to-edge composed canvas height is incorrect',
  );
  const inspected = fittedSurfaceGeometry(1600, 1600, 1058, 748, { inset: 24 });
  assert(inspected.y === 24, 'the ordinary image inspection inset was not preserved');

  removeIfPresent(managed.path);
  removeIfPresent(managedComposition.path);
  removeIfPresent(compositionPath);
  removeIfPresent(exportPath);
  removeIfPresent(workspaceBeforePath);
  removeIfPresent(workspaceAfterPath);
  removeIfPresent(managedDirectory);
  removeIfPresent(root);

  print('image editor renderer is valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
}
