import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import {
  loadVideoWorkspaceSource,
  materializeVideoWorkspaceSource,
  removeMaterializedVideoWorkspaceSource,
  videoWorkspaceSourceDirectory,
} from '../src/services/video-workspace-source.js';
import { createVideoWorkspace } from '../src/video/workspace.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-video-workspace-source-${GLib.uuid_string_random()}`,
]);
let materializedPath = null;
const sourcePath = GLib.build_filenamev([root, 'source.webm']);

function removeIfPresent(path) {
  if (!path) return;
  const file = Gio.File.new_for_path(path);
  if (file.query_exists(null)) file.delete(null);
}

try {
  const bytes = new Uint8Array([26, 69, 223, 163, 147, 66, 130, 136]);
  assert(GLib.mkdir_with_parents(root, 0o700) === 0, 'test source directory was not created');
  GLib.file_set_contents(sourcePath, bytes);
  const loadedSource = await loadVideoWorkspaceSource(sourcePath);
  assert(loadedSource.displayName === 'source.webm', 'loaded source name changed');
  assert(loadedSource.mimeType === 'video/webm', 'loaded source MIME type changed');
  assert(loadedSource.fileSize === bytes.length, 'loaded source size changed');
  assert(loadedSource.modifiedTime > 0, 'loaded source modification time is missing');
  assert(
    loadedSource.bytes.length === bytes.length &&
      loadedSource.bytes.every((byte, index) => byte === bytes[index]),
    'loaded source bytes changed',
  );

  const workspace = createVideoWorkspace({
    sourceBytes: bytes,
    sourceMetadata: {
      displayName: '../private recording.webm',
      durationUs: 1_000_000,
      height: 360,
      originalMimeType: 'video/webm',
      width: 640,
    },
  });
  materializedPath = await materializeVideoWorkspaceSource(workspace, {
    appId: 'test.bolas',
    cacheDirectory: root,
  });
  const expectedDirectory = videoWorkspaceSourceDirectory(root, 'test.bolas');
  assert(GLib.path_get_dirname(materializedPath) === expectedDirectory, 'source escaped its cache');
  assert(materializedPath.endsWith('.webm'), 'source extension was not preserved');
  const [, restored] = GLib.file_get_contents(materializedPath);
  assert(
    restored.length === bytes.length && restored.every((byte, index) => byte === bytes[index]),
    'materialized source bytes changed',
  );
  const mode = Gio.File.new_for_path(materializedPath)
    .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32('unix::mode');
  assert((mode & 0o077) === 0, 'materialized source permissions are not private');
  assert(removeMaterializedVideoWorkspaceSource(materializedPath), 'source cleanup failed');
  materializedPath = null;

  print('video workspace source materialization is valid');
  System.exit(0);
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  System.exit(1);
} finally {
  removeMaterializedVideoWorkspaceSource(materializedPath);
  removeIfPresent(sourcePath);
  for (const path of [
    videoWorkspaceSourceDirectory(root, 'test.bolas'),
    GLib.build_filenamev([root, 'test.bolas']),
    root,
  ]) {
    try {
      removeIfPresent(path);
    } catch {
      // Test cleanup must not hide the assertion result.
    }
  }
}
