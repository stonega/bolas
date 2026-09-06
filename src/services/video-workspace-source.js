import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { APP_ID } from '../config.js';
import { MAX_WORKSPACE_ASSET_BYTES } from '../model/workspace.js';
import { videoWorkspaceSourceBytes } from '../video/workspace.js';

const MIME_EXTENSIONS = Object.freeze({
  'video/3gpp': '3gp',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-m4v': 'm4v',
  'video/x-matroska': 'mkv',
  'video/x-ms-asf': 'asf',
  'video/x-ms-wmv': 'wmv',
  'video/x-msvideo': 'avi',
});
const VIDEO_EXTENSIONS = new Set(Object.values(MIME_EXTENSIONS));

function requireLocalPath(path) {
  const value = String(path ?? '').trim();
  if (!value || !GLib.path_is_absolute(value))
    throw new Error('Choose a local source video for the workspace.');
  return value;
}

function querySourceInfo(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.query_info_async(
      [
        Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
        Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
        Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
        Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
      ].join(','),
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.query_info_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function loadBytes(file, cancellable) {
  return new Promise((resolve, reject) => {
    file.load_bytes_async(cancellable, (source, result) => {
      try {
        const [bytes] = source.load_bytes_finish(result);
        resolve(bytes.toArray());
      } catch (error) {
        reject(error);
      }
    });
  });
}

function writePrivateBytes(file, bytes, cancellable) {
  return new Promise((resolve, reject) => {
    file.replace_contents_bytes_async(
      new GLib.Bytes(bytes),
      null,
      false,
      Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION,
      cancellable,
      (source, result) => {
        try {
          const [success] = source.replace_contents_finish(result);
          if (!success) throw new Error('The embedded workspace video could not be restored.');
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export async function loadVideoWorkspaceSource(path, { cancellable = null } = {}) {
  const localPath = requireLocalPath(path);
  const file = Gio.File.new_for_path(localPath);
  const info = await querySourceInfo(file, cancellable);
  if (info.get_file_type() !== Gio.FileType.REGULAR)
    throw new Error('The workspace source must be a regular video file.');
  const size = Number(info.get_size());
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('The source video is empty.');
  if (size > MAX_WORKSPACE_ASSET_BYTES)
    throw new Error('Videos larger than 128 MiB cannot be embedded in a Bolas workspace.');

  const contentType = info.get_content_type() ?? '';
  const mimeType = Gio.content_type_get_mime_type(contentType) ?? contentType;
  if (!String(mimeType).toLowerCase().startsWith('video/'))
    throw new Error('The workspace source is not a supported video.');
  return {
    bytes: await loadBytes(file, cancellable),
    displayName: info.get_name() || GLib.path_get_basename(localPath),
    fileSize: size,
    mimeType: String(mimeType).toLowerCase(),
    modifiedTime: Number(info.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED)),
  };
}

export function videoWorkspaceSourceDirectory(
  cacheDirectory = GLib.get_user_cache_dir(),
  appId = APP_ID,
) {
  return GLib.build_filenamev([cacheDirectory, String(appId || APP_ID), 'workspace-videos']);
}

function sourceExtension(source) {
  const basename = GLib.path_get_basename(String(source?.displayName ?? ''));
  const dot = basename.lastIndexOf('.');
  const candidate = dot > 0 ? basename.slice(dot + 1).toLowerCase() : '';
  if (VIDEO_EXTENSIONS.has(candidate)) return candidate;
  return MIME_EXTENSIONS[String(source?.originalMimeType ?? '').toLowerCase()] ?? 'video';
}

export async function materializeVideoWorkspaceSource(
  workspace,
  { appId = APP_ID, cacheDirectory = GLib.get_user_cache_dir(), cancellable = null } = {},
) {
  const directory = videoWorkspaceSourceDirectory(cacheDirectory, appId);
  if (GLib.mkdir_with_parents(directory, 0o700) !== 0)
    throw new Error('Could not create the private workspace video cache.');
  if (GLib.chmod(directory, 0o700) !== 0)
    throw new Error('Could not secure the private workspace video cache.');

  const extension = sourceExtension(workspace?.source);
  const path = GLib.build_filenamev([
    directory,
    `${workspace.source.asset.sha256}-${GLib.uuid_string_random()}.${extension}`,
  ]);
  const file = Gio.File.new_for_path(path);
  try {
    await writePrivateBytes(file, videoWorkspaceSourceBytes(workspace), cancellable);
    if (GLib.chmod(path, 0o600) !== 0)
      throw new Error('Could not secure the restored workspace video.');
    return path;
  } catch (error) {
    removeMaterializedVideoWorkspaceSource(path);
    throw error;
  }
}

export function removeMaterializedVideoWorkspaceSource(path) {
  const value = String(path ?? '').trim();
  if (!value || !GLib.path_is_absolute(value)) return false;
  const basename = GLib.path_get_basename(value);
  const parentName = GLib.path_get_basename(GLib.path_get_dirname(value));
  if (
    parentName !== 'workspace-videos' ||
    !/^[a-f0-9]{64}-[a-f0-9-]{36}\.[a-z0-9]{1,10}$/.test(basename)
  )
    return false;
  const file = Gio.File.new_for_path(value);
  if (!file.query_exists(null)) return false;
  try {
    return file.delete(null);
  } catch {
    return false;
  }
}
