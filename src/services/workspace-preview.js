import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Cairo from 'cairo';

import { workspacePreviewPath } from './workspace-library.js';

export const WORKSPACE_PREVIEW_MAX_WIDTH = 640;
export const WORKSPACE_PREVIEW_MAX_HEIGHT = 400;

function positiveLimit(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function surfaceSize(surface) {
  const width = Number(surface?.getWidth?.() ?? 0);
  const height = Number(surface?.getHeight?.() ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('The workspace preview source is invalid.');
  return { height, width };
}

function scaledPreviewSurface(sourceSurface, maxWidth, maxHeight) {
  const source = surfaceSize(sourceSurface);
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const preview = new Cairo.ImageSurface(Cairo.Format.ARGB32, width, height);
  const cr = new Cairo.Context(preview);

  try {
    cr.setOperator(Cairo.Operator.SOURCE);
    cr.scale(width / source.width, height / source.height);
    cr.setSourceSurface(sourceSurface, 0, 0);
    cr.getSource().setFilter(Cairo.Filter.BEST);
    cr.paint();
  } finally {
    cr.$dispose();
  }
  preview.flush();
  return { height, surface: preview, width };
}

export function removeWorkspacePreview(workspacePath) {
  const path = workspacePreviewPath(workspacePath);
  const file = Gio.File.new_for_path(path);
  if (!file.query_exists(null)) return false;
  file.delete(null);
  return true;
}

export function writeWorkspacePreview(
  workspacePath,
  sourceSurface,
  { maxHeight = WORKSPACE_PREVIEW_MAX_HEIGHT, maxWidth = WORKSPACE_PREVIEW_MAX_WIDTH } = {},
) {
  const path = workspacePreviewPath(workspacePath);
  const directory = GLib.path_get_dirname(path);
  const basename = GLib.path_get_basename(path);
  const temporaryPath = GLib.build_filenamev([
    directory,
    `.${basename}.${GLib.uuid_string_random()}.tmp`,
  ]);
  const target = Gio.File.new_for_path(path);
  const temporary = Gio.File.new_for_path(temporaryPath);
  const preview = scaledPreviewSurface(
    sourceSurface,
    positiveLimit(maxWidth, WORKSPACE_PREVIEW_MAX_WIDTH),
    positiveLimit(maxHeight, WORKSPACE_PREVIEW_MAX_HEIGHT),
  );

  try {
    preview.surface.writeToPNG(temporaryPath);
    if (GLib.chmod(temporaryPath, 0o600) !== 0)
      throw new Error('Bolas could not restrict the workspace preview to private access.');
    temporary.move(target, Gio.FileCopyFlags.OVERWRITE, null, null);
    if (GLib.chmod(path, 0o600) !== 0)
      throw new Error('Bolas could not secure the saved workspace preview.');
    return { height: preview.height, path, width: preview.width };
  } finally {
    preview.surface.finish();
    if (temporary.query_exists(null)) {
      try {
        temporary.delete(null);
      } catch {
        // Preserve the preview error while cleaning up the private temporary file.
      }
    }
  }
}

export function writeWorkspacePreviewFromPng(workspacePath, sourcePath, options = {}) {
  const path = String(sourcePath ?? '').trim();
  if (!path || !GLib.path_is_absolute(path))
    throw new Error('A local PNG is required for the workspace preview.');

  const surface = Cairo.ImageSurface.createFromPNG(path);
  try {
    return writeWorkspacePreview(workspacePath, surface, options);
  } finally {
    surface.finish();
  }
}
