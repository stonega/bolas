import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { ImageDocument } from '../src/editor/document.js';
import { loadImageSource } from '../src/editor/renderer.js';
import { exportEditedImage } from '../src/services/image-export.js';

try {
  if (ARGV.length < 2) throw new Error('Usage: gjs -m examples/export-image.js INPUT OUTPUT [png|jpeg]');
  const sourcePath = GLib.canonicalize_filename(ARGV[0], GLib.get_current_dir());
  const source = loadImageSource(sourcePath);
  const result = await exportEditedImage({
    sourcePath,
    sourcePixbuf: source.pixbuf,
    imageDocument: new ImageDocument({ width: source.width, height: source.height }),
    targetPath: GLib.canonicalize_filename(ARGV[1], GLib.get_current_dir()),
    format: ARGV[2] ?? 'png',
    onProgress: ({ message }) => printerr(message),
  });
  print(result.path);
} catch (error) {
  printerr(error.message);
  System.exit(1);
}
