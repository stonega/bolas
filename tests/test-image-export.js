import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { createAnnotation, ImageDocument } from '../src/editor/document.js';
import { renderCompositionToSurface, renderDocumentToSurface } from '../src/editor/renderer.js';
import { exportFormat, exportPathForFormat, videoExportProgress } from '../src/model/export.js';
import { exportEditedImage } from '../src/services/image-export.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function checksum(path) {
  return GLib.compute_checksum_for_bytes(
    GLib.ChecksumType.SHA256,
    new GLib.Bytes(GLib.file_get_contents(path)[1]),
  );
}

const root = GLib.dir_make_tmp('bolas-image-export-test-XXXXXX');
const paths = [];
const pathFor = (name) => {
  const path = GLib.build_filenamev([root, name]);
  paths.push(path);
  return path;
};
let exitCode = 0;
try {
  assert(
    exportPathForFormat('/tmp/image.jpeg', exportFormat('image', 'jpeg')) === '/tmp/image.jpeg',
    'JPEG alias changed',
  );
  assert(
    exportPathForFormat('/tmp/image.png', exportFormat('image', 'jpeg')) === '/tmp/image.jpg',
    'image suffix must follow the chosen format',
  );
  assert(
    exportPathForFormat('/tmp/clip.WEBM', exportFormat('video', 'mp4')) === '/tmp/clip.mp4',
    'video suffix must follow the chosen format',
  );
  assert(
    exportPathForFormat('/tmp/clip', exportFormat('video', 'mp4')) === '/tmp/clip.mp4',
    'missing suffix must be added',
  );
  assert(
    videoExportProgress('out_time_us=500000', 1_000_000) === 0.5,
    'progress must use the edited duration',
  );
  assert(
    videoExportProgress('out_time_us=2000000', 1_000_000) === 0.99,
    'encoding must reserve completion for publication',
  );
  assert(
    videoExportProgress('out_time_us=N/A', 1_000_000) === null,
    'invalid progress must be ignored',
  );
  assert(
    videoExportProgress('progress=end', 1_000_000) === null,
    'encoder end must not declare a successful export',
  );

  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 60);
  pixbuf.fill(0x4488aa00);
  const document = new ImageDocument({ width: 80, height: 60 });
  document.addAnnotation(
    createAnnotation('rectangle', {
      x: 0.2,
      y: 0.2,
      width: 0.5,
      height: 0.4,
      strokeColor: '#ffffff',
    }),
  );
  document.crop({ x: 0, y: 0, width: 0.75, height: 1 });
  document.rotate(1);
  const sourcePath = pathFor('source.png');
  pixbuf.savev(sourcePath, 'png', [], []);
  const options = { sourcePixbuf: pixbuf, imageDocument: document, sourcePath };
  const pngPath = pathFor('export.png');
  const progress = [];
  let ticks = 0;
  const tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1, () => {
    ticks++;
    return GLib.SOURCE_CONTINUE;
  });
  try {
    await exportEditedImage({
      ...options,
      targetPath: pngPath,
      onProgress: (value) => {
        progress.push(value);
        if (value.fraction === 1)
          assert(
            Gio.File.new_for_path(pngPath).query_exists(null),
            'completion fired before output was published',
          );
      },
    });
  } finally {
    GLib.source_remove(tickId);
  }
  assert(ticks > 0, 'image export must yield to the main loop');
  assert(
    progress.some((value) => value.message === 'Rendering image…'),
    'worker render progress was not delivered',
  );
  assert(progress.at(-1).fraction === 1, 'image export must report completion');
  const expectedPath = pathFor('expected.png');
  const expectedSurface = renderDocumentToSurface(pixbuf, document);
  expectedSurface.writeToPNG(expectedPath);
  expectedSurface.finish();
  assert(
    checksum(pngPath) === checksum(expectedPath),
    'worker output differs from the editor renderer',
  );
  const exported = GdkPixbuf.Pixbuf.new_from_file(pngPath);
  assert(exported.get_width() === 60 && exported.get_height() === 60, 'image transforms were lost');
  assert(exported.get_has_alpha() && exported.get_pixels()[3] === 0, 'PNG transparency was lost');
  assert(
    (Gio.File.new_for_path(pngPath)
      .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
      .get_attribute_uint32('unix::mode') &
      0o777) ===
      0o600,
    'image output is not private',
  );

  const jpegPath = pathFor('export.jpg');
  const jpegResult = await exportEditedImage({ ...options, format: 'jpeg', targetPath: jpegPath });
  const jpeg = GdkPixbuf.Pixbuf.new_from_file(jpegPath);
  assert(jpegResult.mimeType === 'image/jpeg', 'JPEG MIME type is incorrect');
  assert(
    GdkPixbuf.Pixbuf.get_file_info(jpegPath)[0].get_name() === 'jpeg',
    'JPEG file has the wrong encoding',
  );
  assert(!jpeg.get_has_alpha(), 'JPEG must be opaque');
  assert(
    Array.from(jpeg.get_pixels().slice(0, 3)).every((value) => value > 245),
    'JPEG transparency must be flattened on white',
  );

  const canvas = new ImageDocument({ width: 1600, height: 1200 });
  canvas.rotate(1);
  const composedPath = pathFor('composed.png');
  const share = { presetId: 'paper', sourceHasTransparency: true };
  await exportEditedImage({ ...options, canvasDocument: canvas, share, targetPath: composedPath });
  const expectedComposition = renderCompositionToSurface(pixbuf, document, canvas, share);
  expectedComposition.writeToPNG(expectedPath);
  expectedComposition.finish();
  assert(
    checksum(composedPath) === checksum(expectedPath),
    'worker must retain both document layers and composition settings',
  );

  for (const targetPath of [sourcePath, pngPath]) {
    const before = checksum(targetPath);
    let refused = false;
    try {
      await exportEditedImage({ ...options, targetPath });
    } catch {
      refused = true;
    }
    assert(refused && before === checksum(targetPath), 'existing image was overwritten');
  }

  const cancelledPath = pathFor('cancelled.png');
  const racedPath = pathFor('created-during-export.png');
  let raceRefused = false;
  try {
    await exportEditedImage({
      ...options,
      targetPath: racedPath,
      onProgress: ({ message }) => {
        if (message === 'Finishing export…') GLib.file_set_contents(racedPath, 'Keep this file');
      },
    });
  } catch {
    raceRefused = true;
  }
  assert(
    raceRefused &&
      new TextDecoder().decode(GLib.file_get_contents(racedPath)[1]) === 'Keep this file',
    'a destination created during rendering must not be replaced',
  );
  const cancellable = new Gio.Cancellable();
  let cancelled = false;
  const cancellationProgress = [];
  try {
    await exportEditedImage({
      ...options,
      share,
      targetPath: cancelledPath,
      cancellable,
      onProgress: (value) => {
        cancellationProgress.push(value);
        if (value.message === 'Rendering image…') cancellable.cancel();
      },
    });
  } catch (error) {
    cancelled = Boolean(error.cancelled);
  }
  assert(
    cancelled && !Gio.File.new_for_path(cancelledPath).query_exists(null),
    'cancelled image export left an output',
  );
  assert(
    !cancellationProgress.some((value) => value.fraction === 1),
    'cancelled image export reported success',
  );
  const entries = Gio.File.new_for_path(root).enumerate_children(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  for (let entry = entries.next_file(null); entry; entry = entries.next_file(null))
    assert(!entry.get_name().startsWith('.bolas-export-'), 'staging directory leaked');
  entries.close(null);
  print('image export formats, progress, cancellation, and atomic destinations are valid');
} catch (error) {
  printerr(error.message);
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  for (const path of paths) if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  GLib.rmdir(root);
}
System.exit(exitCode);
