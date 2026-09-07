import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';
import System from 'system';

import { ImageDocument } from '../editor/document.js';
import { renderCompositionToSurface, renderDocumentToSurface } from '../editor/renderer.js';
import { exportFormat } from '../model/export.js';

// This process receives only a private staging directory. All expensive Cairo
// drawing and image encoding happen here, away from the GTK main loop.
try {
  const directory = ARGV[0];
  const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([directory, 'snapshot.json']));
  const snapshot = JSON.parse(new TextDecoder().decode(bytes));
  exportFormat('image', snapshot.format);
  const source = GdkPixbuf.Pixbuf.new_from_file(GLib.build_filenamev([directory, 'source.png']));
  const document = ImageDocument.fromJSON(snapshot.image);
  print('rendering');
  const surface = snapshot.share
    ? renderCompositionToSurface(
        source,
        document,
        snapshot.canvas ? ImageDocument.fromJSON(snapshot.canvas) : null,
        snapshot.share,
      )
    : renderDocumentToSurface(source, document);
  const outputPath = GLib.build_filenamev([directory, 'output']);
  try {
    print('encoding');
    if (snapshot.format === 'png') surface.writeToPNG(outputPath);
    else {
      const opaque = new Cairo.ImageSurface(
        Cairo.Format.RGB24,
        surface.getWidth(),
        surface.getHeight(),
      );
      const context = new Cairo.Context(opaque);
      const pngPath = GLib.build_filenamev([directory, 'render.png']);
      try {
        context.setSourceRGB(1, 1, 1);
        context.paint();
        context.setSourceSurface(surface, 0, 0);
        context.paint();
        opaque.writeToPNG(pngPath);
        GdkPixbuf.Pixbuf.new_from_file(pngPath).savev(outputPath, 'jpeg', ['quality'], ['95']);
      } finally {
        context.$dispose();
        opaque.finish();
      }
    }
  } finally {
    surface.finish();
  }
} catch (error) {
  printerr(error.message);
  System.exit(1);
}
