import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { WORKSPACE_EXTENSION, WORKSPACE_MIME_TYPE } from '../config.js';
import { hasWorkspaceMagic } from '../services/workspace-file.js';
import { inspectImagePath } from './image-file.js';

const VIDEO_FORMAT_LABELS = Object.freeze({
  'video/3gpp': '3GPP',
  'video/mp4': 'MP4',
  'video/mpeg': 'MPEG',
  'video/ogg': 'Ogg Video',
  'video/quicktime': 'QuickTime',
  'video/webm': 'WebM',
  'video/x-m4v': 'M4V',
  'video/x-matroska': 'Matroska',
  'video/x-ms-asf': 'Windows Media',
  'video/x-ms-wmv': 'WMV',
  'video/x-msvideo': 'AVI',
});

export const SUPPORTED_VIDEO_MIME_TYPES = Object.freeze(Object.keys(VIDEO_FORMAT_LABELS));

function extensionLabel(basename) {
  const name = String(basename ?? '');
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'Video';
  return name.slice(dot + 1).toUpperCase();
}

export function videoFormatLabel(mimeType, basename = '') {
  const normalized = String(mimeType ?? '').toLowerCase();
  return VIDEO_FORMAT_LABELS[normalized] ?? extensionLabel(basename);
}

export function inspectMediaPath(path) {
  const resolvedPath = String(path ?? '');
  if (!resolvedPath || !GLib.path_is_absolute(resolvedPath)) {
    throw new Error('Choose a local image or video file.');
  }

  const file = Gio.File.new_for_path(resolvedPath);
  if (!file.query_exists(null)) {
    throw new Error('The selected file no longer exists.');
  }

  const info = file.query_info(
    [Gio.FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE, Gio.FILE_ATTRIBUTE_STANDARD_TYPE].join(','),
    Gio.FileQueryInfoFlags.NONE,
    null,
  );
  if (info.get_file_type() !== Gio.FileType.REGULAR) {
    throw new Error('Choose a regular image or video file.');
  }

  const contentType = info.get_content_type() ?? '';
  const mimeType = Gio.content_type_get_mime_type(contentType) ?? contentType;
  const basename = GLib.path_get_basename(resolvedPath);
  const looksLikeWorkspace =
    mimeType === WORKSPACE_MIME_TYPE || basename.toLowerCase().endsWith(WORKSPACE_EXTENSION);
  const workspaceMagic = hasWorkspaceMagic(resolvedPath);
  if (looksLikeWorkspace || workspaceMagic) {
    if (!workspaceMagic) throw new Error('The selected Bolas workspace is damaged.');
    return {
      basename,
      format: 'Bolas Workspace',
      kind: 'workspace',
      mimeType: WORKSPACE_MIME_TYPE,
      path: resolvedPath,
    };
  }
  if (mimeType.toLowerCase().startsWith('video/')) {
    return {
      basename,
      format: videoFormatLabel(mimeType, basename),
      kind: 'video',
      mimeType,
      path: resolvedPath,
    };
  }

  try {
    return { ...inspectImagePath(resolvedPath), kind: 'image', mimeType };
  } catch {
    throw new Error('The selected file is not a supported image, video, or Bolas workspace.');
  }
}

export function inspectMediaFile(file) {
  const path = file?.get_path?.() ?? '';
  return inspectMediaPath(path);
}
