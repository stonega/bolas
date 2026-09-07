import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { exportFormat } from '../model/export.js';
import { checkExportCancellation, runExportProcess } from './export-process.js';

async function saveSource(pixbuf, file, cancellable) {
  const stream = await new Promise((resolve, reject) => {
    file.create_async(
      Gio.FileCreateFlags.PRIVATE,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.create_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
  try {
    await new Promise((resolve, reject) => {
      pixbuf.save_to_streamv_async(stream, 'png', [], [], cancellable, (_source, result) => {
        try {
          resolve(GdkPixbuf.Pixbuf.save_to_stream_finish(result));
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    await new Promise((resolve, reject) => {
      stream.close_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
        try {
          resolve(source.close_finish(result));
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

export async function exportEditedImage({
  sourcePixbuf,
  imageDocument,
  canvasDocument = null,
  share = null,
  sourcePath,
  targetPath,
  format = 'png',
  cancellable = null,
  onProgress = null,
}) {
  const selectedFormat = exportFormat('image', format);
  checkExportCancellation(cancellable);
  if (!sourcePixbuf || !imageDocument) throw new Error('Open an image before exporting.');
  if (!targetPath || !GLib.path_is_absolute(targetPath))
    throw new Error('Choose a local export path.');
  const destination = Gio.File.new_for_path(targetPath);
  if (sourcePath && destination.equal(Gio.File.new_for_path(sourcePath)))
    throw new Error('Choose a new filename. Bolas never overwrites the original image.');
  if (destination.query_exists(cancellable))
    throw new Error(
      `A file named ${destination.get_basename()} already exists. Choose a new filename.`,
    );

  // Capture documents before the first await; the oriented pixels are immutable.
  const snapshot = JSON.stringify({
    image: imageDocument.toJSON(),
    canvas: canvasDocument?.toJSON() ?? null,
    share,
    format,
  });
  const directory = GLib.path_get_dirname(targetPath);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the image export directory.');
  const staging = GLib.build_filenamev([directory, `.bolas-export-${GLib.uuid_string_random()}`]);
  // Gio refuses an existing directory, keeping cleanup confined to files we own.
  Gio.File.new_for_path(staging).make_directory(cancellable);
  if (GLib.chmod(staging, 0o700) !== 0) {
    GLib.rmdir(staging);
    throw new Error('Could not secure temporary image export files.');
  }
  const sourceFile = Gio.File.new_for_path(GLib.build_filenamev([staging, 'source.png']));
  const snapshotFile = Gio.File.new_for_path(GLib.build_filenamev([staging, 'snapshot.json']));
  const outputPath = GLib.build_filenamev([staging, 'output']);
  try {
    onProgress?.({ fraction: null, message: 'Preparing image…' });
    await saveSource(sourcePixbuf, sourceFile, cancellable);
    await new Promise((resolve, reject) => {
      snapshotFile.replace_contents_async(
        new TextEncoder().encode(snapshot),
        null,
        false,
        Gio.FileCreateFlags.PRIVATE,
        cancellable,
        (source, result) => {
          try {
            resolve(source.replace_contents_finish(result));
          } catch (error) {
            reject(error);
          }
        },
      );
    });
    const worker = Gio.File.new_for_uri(import.meta.url)
      .get_parent()
      .get_child('image-export-worker.js')
      .get_path();
    await runExportProcess(['gjs', '-m', worker, staging], {
      cancellable,
      failureMessage: 'Image export failed.',
      unavailableMessage: 'The GJS image exporter is unavailable.',
      onLine: (line) => {
        const message = { rendering: 'Rendering image…', encoding: 'Encoding image…' }[line];
        if (message) onProgress?.({ fraction: null, message });
      },
    });
    checkExportCancellation(cancellable);
    onProgress?.({ fraction: null, message: 'Finishing export…' });
    if (GLib.chmod(outputPath, 0o600) !== 0)
      throw new Error('Could not secure the exported image.');
    Gio.File.new_for_path(outputPath).move(destination, Gio.FileCopyFlags.NONE, cancellable, null);
    onProgress?.({ fraction: 1, message: 'Export complete' });
    return { path: targetPath, mimeType: selectedFormat.mimeType };
  } finally {
    for (const name of ['source.png', 'snapshot.json', 'render.png', 'output']) {
      const path = GLib.build_filenamev([staging, name]);
      if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
    }
    GLib.rmdir(staging);
  }
}
