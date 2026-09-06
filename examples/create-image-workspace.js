import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { ImageDocument } from '../src/editor/document.js';
import { encodePixbufPng, loadImageSource } from '../src/editor/renderer.js';
import { createImageWorkspace } from '../src/editor/workspace.js';
import { writeImageWorkspace } from '../src/services/workspace-file.js';
import { nextManagedWorkspacePath } from '../src/services/workspace-library.js';
import { shareCanvasSize } from '../src/share/renderer.js';

const [sourcePath] = ARGV;

if (!sourcePath) {
  printerr('Usage: gjs -m examples/create-image-workspace.js SOURCE_IMAGE');
  System.exit(2);
}

try {
  if (!GLib.path_is_absolute(sourcePath)) throw new Error('Use an absolute source path.');

  const source = loadImageSource(sourcePath);
  const canvas = shareCanvasSize('landscape');
  const workspace = createImageWorkspace({
    canvasDocument: new ImageDocument({ height: canvas.height, width: canvas.width }),
    composition: {
      backgroundEnabled: true,
      settings: {
        cornerRadius: 42,
        padding: 0.085,
        presetId: 'aurora',
        ratioId: 'landscape',
        shadow: true,
        shadowStrength: 1,
      },
    },
    imageDocument: new ImageDocument({ height: source.height, width: source.width }),
    sourceBytes: encodePixbufPng(source.pixbuf),
    sourceMetadata: {
      displayName: source.displayName,
      height: source.height,
      originalMimeType: source.mimeType,
      width: source.width,
    },
  });

  const workspacePath = nextManagedWorkspacePath(source.displayName);
  const saved = await writeImageWorkspace(workspacePath, workspace);
  print(saved.path);
  System.exit(0);
} catch (error) {
  printerr(error.message);
  System.exit(1);
}
