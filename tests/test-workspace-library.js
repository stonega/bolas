import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';

import {
  ensureManagedWorkspaceDirectory,
  isManagedWorkspacePath,
  isWorkspaceLibraryName,
  managedWorkspaceDirectory,
  managedWorkspaceSavePath,
  nextManagedWorkspacePath,
  workspaceLibraryTitle,
  workspacePreviewPath,
} from '../src/services/workspace-library.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = GLib.build_filenamev([
  GLib.get_tmp_dir(),
  `bolas-workspace-library-${GLib.uuid_string_random()}`,
]);
const appId = 'io.test.Bolas';
const directory = managedWorkspaceDirectory(root, appId);
const createdFiles = [];
let exitCode = 0;

try {
  assert(
    directory === GLib.build_filenamev([root, appId, 'workspaces']),
    'managed workspace directory is incorrect',
  );
  assert(
    ensureManagedWorkspaceDirectory(root, appId) === directory,
    'workspace directory was not created',
  );
  const mode = Gio.File.new_for_path(directory)
    .query_info(Gio.FILE_ATTRIBUTE_UNIX_MODE, Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE);
  assert((mode & 0o077) === 0, 'workspace directory permissions are not private');

  const firstPath = managedWorkspaceSavePath('', 'Screenshot 01.png', root, appId);
  assert(
    firstPath === GLib.build_filenamev([directory, 'Screenshot 01.bolas']),
    'first workspace name is incorrect',
  );
  GLib.file_set_contents(firstPath, 'workspace');
  createdFiles.push(firstPath);
  assert(
    managedWorkspaceSavePath(firstPath, 'ignored.png', root, appId) === firstPath,
    'an existing managed workspace did not remain the save target',
  );
  const secondPath = nextManagedWorkspacePath('Screenshot 01.png', root, appId);
  assert(
    secondPath === GLib.build_filenamev([directory, 'Screenshot 01-2.bolas']),
    'workspace collision did not receive a sequence number',
  );

  const reservedBackupPath = `${secondPath}~`;
  GLib.file_set_contents(reservedBackupPath, 'backup');
  createdFiles.push(reservedBackupPath);
  assert(
    nextManagedWorkspacePath('Screenshot 01.png', root, appId) ===
      GLib.build_filenamev([directory, 'Screenshot 01-3.bolas']),
    'workspace naming did not avoid a recovery-backup collision',
  );
  const capturedPath = nextManagedWorkspacePath('screenshot-1234567890abcdef.png', root, appId);
  assert(
    GLib.path_get_basename(capturedPath).startsWith('Screenshot 20') &&
      capturedPath.endsWith('.bolas'),
    'managed captures did not receive a readable date-based name',
  );

  assert(isWorkspaceLibraryName('Project.bolas'), 'workspace extension was not recognized');
  assert(!isWorkspaceLibraryName('Project.bolas~'), 'workspace backup appeared in Recents');
  assert(workspaceLibraryTitle('Project.bolas') === 'Project', 'workspace title is incorrect');
  assert(
    workspacePreviewPath(firstPath) === `${firstPath}.preview.png`,
    'workspace preview path is incorrect',
  );
  assert(
    isManagedWorkspacePath(firstPath, root, appId),
    'managed workspace path was not recognized',
  );
  assert(
    !isManagedWorkspacePath(GLib.build_filenamev([root, 'external.bolas']), root, appId),
    'external workspace path was treated as managed',
  );

  print('managed workspace library rules are valid');
} catch (error) {
  printerr(String(error));
  printerr(error.stack ?? error.message);
  exitCode = 1;
} finally {
  for (const path of createdFiles) {
    if (GLib.file_test(path, GLib.FileTest.EXISTS)) GLib.unlink(path);
  }
  for (const path of [directory, GLib.path_get_dirname(directory), root]) {
    try {
      if (Gio.File.new_for_path(path).query_exists(null)) Gio.File.new_for_path(path).delete(null);
    } catch {
      // Preserve the test failure while cleaning up the temporary hierarchy.
    }
  }
}

System.exit(exitCode);
