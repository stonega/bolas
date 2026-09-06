import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import { ImageDocument } from '../src/editor/document.js';
import { createImageWorkspace } from '../src/editor/workspace.js';
import { readImageWorkspace, writeImageWorkspace } from '../src/services/workspace-file.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPrivate(path, message) {
  const mode = Gio.File.new_for_path(path)
    .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32('unix::mode');
  assert((mode & 0o077) === 0, message);
}

const token = GLib.uuid_string_random();
const path = GLib.build_filenamev([GLib.get_tmp_dir(), `bolas-workspace-${token}.bolas`]);
const existingPath = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-workspace-existing-${token}.bolas`,
]);
const temporaryPaths = [path, `${path}~`, existingPath, `${existingPath}~`];
let exitCode = 0;

function workspaceWithPadding(padding) {
  return createImageWorkspace({
    composition: {
      backgroundEnabled: false,
      settings: { padding },
    },
    imageDocument: new ImageDocument({ height: 24, width: 32 }),
    sourceBytes: new Uint8Array([1, 2, 3, 4]),
    sourceMetadata: {
      displayName: 'source.png',
      height: 24,
      originalMimeType: 'image/png',
      width: 32,
    },
  });
}

try {
  const firstSave = await writeImageWorkspace(path, workspaceWithPadding(0.1));
  assert(GLib.file_test(path, GLib.FileTest.EXISTS), 'workspace file was not created');
  assertPrivate(path, 'new workspace permissions are not private');
  const firstRead = await readImageWorkspace(path);
  assert(firstRead.etag === firstSave.etag, 'saved workspace etag was not returned');
  assert(firstRead.workspace.composition.settings.padding === 0.1, 'workspace contents changed');

  const secondSave = await writeImageWorkspace(path, workspaceWithPadding(0.14), {
    etag: firstRead.etag,
    replaceExisting: true,
  });
  const secondRead = await readImageWorkspace(path);
  assert(secondRead.etag === secondSave.etag, 'updated workspace etag was not returned');
  assert(secondRead.workspace.composition.settings.padding === 0.14, 'workspace update failed');
  assertPrivate(path, 'updated workspace permissions are not private');
  if (GLib.file_test(`${path}~`, GLib.FileTest.EXISTS))
    assertPrivate(`${path}~`, 'workspace backup permissions are not private');

  await writeImageWorkspace(existingPath, workspaceWithPadding(0.2));
  let rejectedExisting = false;
  try {
    await writeImageWorkspace(existingPath, workspaceWithPadding(0.18));
  } catch {
    rejectedExisting = true;
  }
  assert(rejectedExisting, 'Save As overwrote an existing workspace');

  let rejectedStaleEtag = false;
  try {
    await writeImageWorkspace(path, workspaceWithPadding(0.16), {
      etag: firstRead.etag,
      replaceExisting: true,
    });
  } catch {
    rejectedStaleEtag = true;
  }
  assert(rejectedStaleEtag, 'a stale workspace etag was accepted');

  print('workspace file persistence is valid');
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  for (const temporaryPath of temporaryPaths) {
    if (GLib.file_test(temporaryPath, GLib.FileTest.EXISTS)) GLib.unlink(temporaryPath);
  }
}

System.exit(exitCode);
