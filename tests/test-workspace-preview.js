import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';
import System from 'system';

import {
  removeWorkspacePreview,
  writeWorkspacePreview,
  writeWorkspacePreviewFromPng,
} from '../src/services/workspace-preview.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertPrivate(path, message) {
  const mode = Gio.File.new_for_path(path)
    .query_info(Gio.FILE_ATTRIBUTE_UNIX_MODE, Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE);
  assert((mode & 0o077) === 0, message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-workspace-preview-${GLib.uuid_string_random()}`,
]);
const workspacePath = GLib.build_filenamev([root, 'Project.bolas']);
const previewPath = `${workspacePath}.preview.png`;
const source = new Cairo.ImageSurface(Cairo.Format.ARGB32, 800, 600);
let loaded = null;
let exitCode = 0;

try {
  assert(GLib.mkdir_with_parents(root, 0o700) === 0, 'preview test directory was not created');
  const cr = new Cairo.Context(source);
  try {
    cr.setSourceRGBA(0.1, 0.4, 0.8, 1);
    cr.paint();
  } finally {
    cr.$dispose();
  }
  source.flush();

  const saved = writeWorkspacePreview(workspacePath, source, {
    maxHeight: 200,
    maxWidth: 320,
  });
  assert(saved.path === previewPath, 'workspace preview path changed');
  assert(saved.width === 267 && saved.height === 200, 'workspace preview was not bounded');
  assert(GLib.file_test(previewPath, GLib.FileTest.EXISTS), 'workspace preview was not saved');
  assertPrivate(previewPath, 'workspace preview permissions are not private');

  loaded = Cairo.ImageSurface.createFromPNG(previewPath);
  assert(
    loaded.getWidth() === saved.width && loaded.getHeight() === saved.height,
    'saved workspace preview dimensions are incorrect',
  );
  loaded.finish();
  loaded = null;

  const replacement = writeWorkspacePreview(workspacePath, source, {
    maxHeight: 100,
    maxWidth: 100,
  });
  assert(replacement.width === 100 && replacement.height === 75, 'preview was not replaced');
  assertPrivate(previewPath, 'replaced workspace preview permissions are not private');
  const copied = writeWorkspacePreviewFromPng(workspacePath, previewPath, {
    maxHeight: 50,
    maxWidth: 80,
  });
  assert(copied.width === 67 && copied.height === 50, 'PNG workspace cover was not bounded');
  assertPrivate(previewPath, 'copied workspace preview permissions are not private');
  assert(removeWorkspacePreview(workspacePath), 'workspace preview was not removed');
  assert(!removeWorkspacePreview(workspacePath), 'workspace preview removal is not idempotent');

  print('workspace preview persistence is valid');
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  loaded?.finish();
  source.finish();
  for (const path of [previewPath, workspacePath]) {
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  }
  try {
    if (Gio.File.new_for_path(root).query_exists(null)) Gio.File.new_for_path(root).delete(null);
  } catch {
    // Preserve the test result while cleaning up the private test directory.
  }
}

System.exit(exitCode);
