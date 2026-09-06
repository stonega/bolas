import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { APP_ID, WORKSPACE_EXTENSION } from '../config.js';

export const WORKSPACE_LIBRARY_DIRECTORY_NAME = 'workspaces';

function requireBaseDirectory(path) {
  const normalized = String(path ?? '').trim();
  if (!normalized || !GLib.path_is_absolute(normalized))
    throw new Error('The workspace library requires a local data directory.');
  return normalized;
}

function workspaceStem(sourceName) {
  const basename = GLib.path_get_basename(String(sourceName ?? '').trim() || 'Untitled');
  const dot = basename.lastIndexOf('.');
  const withoutExtension = dot > 0 ? basename.slice(0, dot) : basename;
  const withoutControlCharacters = [...withoutExtension]
    .map((character) => (character.codePointAt(0) < 32 ? '-' : character))
    .join('');
  const safe = withoutControlCharacters
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 48);
  if (/^screenshot-[0-9a-f-]{16,}$/i.test(safe)) {
    const created = GLib.DateTime.new_now_local().format('%Y-%m-%d %H.%M');
    return `Screenshot ${created}`;
  }
  return safe || 'Untitled';
}

export function managedWorkspaceDirectory(
  dataDirectory = GLib.get_user_data_dir(),
  appId = APP_ID,
) {
  return GLib.build_filenamev([
    requireBaseDirectory(dataDirectory),
    String(appId || APP_ID),
    WORKSPACE_LIBRARY_DIRECTORY_NAME,
  ]);
}

export function ensureManagedWorkspaceDirectory(
  dataDirectory = GLib.get_user_data_dir(),
  appId = APP_ID,
) {
  const directory = managedWorkspaceDirectory(dataDirectory, appId);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Bolas could not create its workspace library.');
  if (GLib.chmod(directory, 0o700) !== 0)
    throw new Error('Bolas could not restrict its workspace library to private access.');
  return directory;
}

export function isWorkspaceLibraryName(name) {
  const normalized = String(name ?? '')
    .trim()
    .toLowerCase();
  return (
    normalized.endsWith(WORKSPACE_EXTENSION) && !normalized.endsWith(`${WORKSPACE_EXTENSION}~`)
  );
}

export function workspaceLibraryTitle(name) {
  const basename = GLib.path_get_basename(String(name ?? '').trim());
  return isWorkspaceLibraryName(basename)
    ? basename.slice(0, -WORKSPACE_EXTENSION.length)
    : workspaceStem(basename);
}

export function workspacePreviewPath(workspacePath) {
  const normalized = String(workspacePath ?? '').trim();
  if (
    !normalized ||
    !GLib.path_is_absolute(normalized) ||
    !isWorkspaceLibraryName(GLib.path_get_basename(normalized))
  )
    throw new Error('A local Bolas workspace is required for its preview.');
  return `${normalized}.preview.png`;
}

export function isManagedWorkspacePath(
  path,
  dataDirectory = GLib.get_user_data_dir(),
  appId = APP_ID,
) {
  const normalized = String(path ?? '').trim();
  if (!normalized || !GLib.path_is_absolute(normalized)) return false;
  const parent = GLib.canonicalize_filename(GLib.path_get_dirname(normalized), null);
  const library = GLib.canonicalize_filename(managedWorkspaceDirectory(dataDirectory, appId), null);
  return parent === library && isWorkspaceLibraryName(GLib.path_get_basename(normalized));
}

export function nextManagedWorkspacePath(
  sourceName,
  dataDirectory = GLib.get_user_data_dir(),
  appId = APP_ID,
) {
  const directory = ensureManagedWorkspaceDirectory(dataDirectory, appId);
  const stem = workspaceStem(sourceName);

  for (let sequence = 1; sequence <= 9999; sequence++) {
    const suffix = sequence === 1 ? '' : `-${sequence}`;
    const path = GLib.build_filenamev([directory, `${stem}${suffix}${WORKSPACE_EXTENSION}`]);
    if (
      !Gio.File.new_for_path(path).query_exists(null) &&
      !Gio.File.new_for_path(`${path}~`).query_exists(null)
    )
      return path;
  }

  return GLib.build_filenamev([
    directory,
    `${stem}-${GLib.uuid_string_random()}${WORKSPACE_EXTENSION}`,
  ]);
}

export function managedWorkspaceSavePath(
  existingPath,
  sourceName,
  dataDirectory = GLib.get_user_data_dir(),
  appId = APP_ID,
) {
  const current = String(existingPath ?? '').trim();
  if (!current) return nextManagedWorkspacePath(sourceName, dataDirectory, appId);
  if (!isManagedWorkspacePath(current, dataDirectory, appId))
    throw new Error('Bolas can only update workspaces in its managed library.');
  return GLib.canonicalize_filename(current, null);
}
