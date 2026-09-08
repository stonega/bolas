import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { ImageDocument } from '../src/editor/document.js';
import { encodePixbufPng } from '../src/editor/renderer.js';
import { createImageWorkspace } from '../src/editor/workspace.js';
import { exportEditedImage } from '../src/services/image-export.js';
import { readImageWorkspace, writeImageWorkspace } from '../src/services/workspace-file.js';
import { managedWorkspaceSavePath } from '../src/services/workspace-library.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Exercise the launcher's import boundary with the same synchronous main loop
// used by Gio.Application.run(), without opening a window or using a session bus.
const loop = new GLib.MainLoop(null, false);
const directory = ARGV[0];
let exitCode = 1;
let stage = 'resuming the Save action';
const deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
  printerr(`Installed launcher stalled while ${stage}`);
  System.exit(1);
  return GLib.SOURCE_REMOVE;
});

async function saveAndExport() {
  // Save awaits static-image acceptance even when no confirmation is needed.
  await Promise.resolve(true);
  const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 80, 60);
  pixbuf.fill(0x4488aaff);
  const document = new ImageDocument({ width: 80, height: 60 });
  document.rotate(1);
  const workspace = createImageWorkspace({
    composition: { backgroundEnabled: false },
    imageDocument: document,
    sourceBytes: encodePixbufPng(pixbuf),
    sourceMetadata: { displayName: 'Synthetic.png', width: 80, height: 60 },
  });
  stage = 'saving the workspace';
  const path = managedWorkspaceSavePath(null, 'Synthetic.png', directory);
  const saved = await writeImageWorkspace(path, workspace);
  const loaded = await readImageWorkspace(path);
  assert(saved.etag === loaded.etag, 'Saved workspace could not be reopened');
  assert(loaded.workspace.source.width === 80, 'Workspace lost its embedded image metadata');
  await writeImageWorkspace(path, workspace, { etag: loaded.etag, replaceExisting: true });

  for (const format of ['png', 'jpeg']) {
    stage = `exporting ${format}`;
    const targetPath = GLib.build_filenamev([directory, `export.${format}`]);
    let complete = false;
    const result = await exportEditedImage({
      sourcePixbuf: pixbuf,
      imageDocument: document,
      targetPath,
      format,
      onProgress: ({ fraction }) => {
        if (fraction === 1) complete = true;
      },
    });
    const output = GdkPixbuf.Pixbuf.new_from_file(result.path);
    assert(complete, `${format} export never reported completion`);
    assert(
      output.get_width() === 60 && output.get_height() === 80,
      `${format} export lost image edits`,
    );
    const mode = Gio.File.new_for_path(result.path)
      .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
      .get_attribute_uint32('unix::mode');
    assert((mode & 0o777) === 0o600, `${format} export is not private`);
  }
}

GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
  saveAndExport()
    .then(() => {
      exitCode = 0;
      print('Installed launcher completes workspace Save, reopen, update, and PNG/JPEG Export');
    })
    .catch((error) => {
      printerr(`${stage}: ${error.message}`);
      printerr(error.stack);
    })
    .finally(() => loop.quit());
  return GLib.SOURCE_REMOVE;
});
loop.run();
GLib.source_remove(deadline);
System.exit(exitCode);
